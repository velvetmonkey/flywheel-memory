/**
 * Proactive wikilink background writer (arch-review G5, part F2)
 *
 * Applies high-confidence wikilink suggestions to files on disk from the
 * background pipeline (no tool invocation). File I/O is guarded by the
 * per-path lock so it can't race engine renders or tool mutations.
 */

import path from 'path';
import * as fs from 'fs/promises';
import {
  applyWikilinks,
  getEntityByName,
  type Entity,
} from '@velvetmonkey/vault-core';
import { isSuppressed, trackWikilinkApplications } from './wikilinkFeedback.js';
import { markSuggestionEventsApplied } from './wikilinkFeedbackStore.js';
import { withPathLock, pathLockKey } from './path-lock.js';
import { getWriteStateDb } from './wikilinkState.js';
import { isCommonWordFalsePositive } from './wikilinkScoringConfig.js';

/**
 * Apply high-confidence proactive wikilinks to a file.
 *
 * Only inserts entities that scored above the proactive threshold with
 * 'high' confidence. Uses applyWikilinks from vault-core (no implicit
 * entity detection). Skips files modified within the last 30 seconds
 * to avoid clashing with active editing.
 */
export async function applyProactiveSuggestions(
  filePath: string,
  vaultPath: string,
  suggestions: Array<{ entity: string; score: number; confidence: string }>,
  config: { minScore: number; maxPerFile: number },
): Promise<{ applied: string[]; skipped: string[] }> {
  const stateDb = getWriteStateDb();

  // Filter to high-confidence suggestions above threshold
  const candidates = suggestions
    .filter(s => s.score >= config.minScore && s.confidence === 'high')
    .slice(0, config.maxPerFile);

  if (candidates.length === 0) {
    return { applied: [], skipped: [] };
  }

  const fullPath = path.join(vaultPath, filePath);

  // Skip files modified within last 30 seconds (active editing)
  try {
    const stat = await fs.stat(fullPath);
    if (Date.now() - stat.mtimeMs < 30_000) {
      return { applied: [], skipped: candidates.map(c => c.entity) };
    }
  } catch {
    return { applied: [], skipped: candidates.map(c => c.entity) };
  }

  // Per-path lock: read → link → write must be atomic vs engine renders /
  // tool mutations of the same note (TOCTOU). See path-lock.ts.
  return withPathLock(pathLockKey(vaultPath, filePath), async () => {
  // Read current file content
  let content: string;
  try {
    content = await fs.readFile(fullPath, 'utf-8');
  } catch {
    return { applied: [], skipped: candidates.map(c => c.entity) };
  }

  // Build Entity objects for candidates, filtering out suppressed entities
  const entityObjects: Entity[] = [];
  for (const candidate of candidates) {
    if (stateDb && isSuppressed(stateDb, candidate.entity)) continue;

    // Look up entity in stateDb to get aliases and category
    if (stateDb) {
      const entityObj = getEntityByName(stateDb, candidate.entity);
      // Defense-in-depth: skip common-word false positives
      const category = entityObj?.category ?? 'other';
      if (isCommonWordFalsePositive(candidate.entity, content, category)) continue;
      if (entityObj) {
        entityObjects.push({
          name: entityObj.name,
          path: entityObj.path,
          aliases: entityObj.aliases ?? [],
        });
        continue;
      }
    }
    // Fallback: use entity name as a string entity
    entityObjects.push(candidate.entity);
  }

  if (entityObjects.length === 0) {
    return { applied: [], skipped: candidates.map(c => c.entity) };
  }

  // Apply wikilinks with only the high-confidence entities (no implicit detection)
  const result = applyWikilinks(content, entityObjects, {
    firstOccurrenceOnly: true,
    caseInsensitive: true,
  });

  if (result.linksAdded === 0) {
    return { applied: [], skipped: candidates.map(c => c.entity) };
  }

  // Write back to file
  try {
    await fs.writeFile(fullPath, result.content, 'utf-8');
  } catch {
    return { applied: [], skipped: candidates.map(c => c.entity) };
  }

  // Track applications for feedback loop
  if (stateDb) {
    trackWikilinkApplications(stateDb, filePath, result.linkedEntities, 'proactive');

    // Mark as applied in suggestion_events
    try {
      markSuggestionEventsApplied(stateDb, filePath, result.linkedEntities);
    } catch {
      // Non-critical
    }
  }

  return {
    applied: result.linkedEntities,
    skipped: candidates
      .map(c => c.entity)
      .filter(e => !result.linkedEntities.includes(e)),
  };
  });
}

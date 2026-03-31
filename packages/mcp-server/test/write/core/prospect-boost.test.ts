/**
 * Tests for Layer 14: Prospect Boost in wikilink scoring pipeline.
 *
 * Proves the prospect contribution through score breakdowns and controlled
 * ablation, not incidental ranking shifts from other boosts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { openStateDb, type StateDb } from '@velvetmonkey/vault-core';
import {
  initializeEntityIndex,
  suggestRelatedLinks,
  setWriteStateDb,
} from '../../../src/core/write/wikilinks.js';
import {
  setProspectStateDb,
  resetCleanupCooldown,
} from '../../../src/core/shared/prospects.js';
import {
  createTempVault,
  cleanupTempVault,
  createEntityCacheInStateDb,
} from '../helpers/testUtils.js';
import { writeFile, mkdir } from 'fs/promises';

let tempVault: string;
let stateDb: StateDb;

describe('Layer 14: Prospect Boost', () => {
  beforeEach(async () => {
    tempVault = await createTempVault();

    // Create same-category, same-folder entity notes
    await mkdir(path.join(tempVault, 'tools'), { recursive: true });
    await writeFile(
      path.join(tempVault, 'tools', 'Widget Framework.md'),
      '---\ntype: technology\n---\n# Widget Framework\n\nA framework for building widgets.\n',
    );
    await writeFile(
      path.join(tempVault, 'tools', 'Gadget Library.md'),
      '---\ntype: technology\n---\n# Gadget Library\n\nA library for building gadgets.\n',
    );

    stateDb = openStateDb(tempVault);
    setWriteStateDb(stateDb);
    setProspectStateDb(stateDb);
    resetCleanupCooldown();

    // Seed entities in StateDb
    createEntityCacheInStateDb(stateDb, tempVault, {
      technologies: ['Widget Framework', 'Gadget Library'],
    });

    // Initialize entity index from StateDb
    await initializeEntityIndex(tempVault);
  }, 30000);

  afterEach(async () => {
    setWriteStateDb(null);
    setProspectStateDb(null);
    try { stateDb?.close(); } catch { /* ignore */ }
    await cleanupTempVault(tempVault);
  });

  it('boosted entity has positive Layer 14 contribution', async () => {
    const now = Date.now();
    // Seed prospect for Widget Framework (score=60, just seen → effective ~60, boost = min(6, 60/10) = 6)
    stateDb.db.exec(`
      INSERT INTO prospect_summary
        (term, display_name, note_count, day_count, total_sightings, backlink_max, best_source, best_confidence, best_score, first_seen_at, last_seen_at, promotion_score, updated_at)
      VALUES
        ('widget framework', 'Widget Framework', 10, 8, 30, 5, 'dead_link', 'high', 3, ${now - 30 * 86400000}, ${now}, 60, ${now})
    `);

    const result = await suggestRelatedLinks(
      'We should evaluate Widget Framework and Gadget Library for the new project.',
      { detail: true, maxSuggestions: 10 },
    );

    expect(result.detailed).toBeDefined();

    const widget = result.detailed!.find(d => d.entity === 'Widget Framework');
    const gadget = result.detailed!.find(d => d.entity === 'Gadget Library');

    expect(widget).toBeDefined();
    expect(gadget).toBeDefined();

    // Widget has prospect boost, Gadget does not
    expect(widget!.breakdown.prospectBoost ?? 0).toBeGreaterThan(0);
    expect(gadget!.breakdown.prospectBoost ?? 0).toBe(0);

    // Widget should rank higher due to the boost
    expect(widget!.totalScore).toBeGreaterThan(gadget!.totalScore);
  });

  it('disabledLayers: prospect_boost removes Layer 14 contribution', async () => {
    const now = Date.now();
    stateDb.db.exec(`
      INSERT INTO prospect_summary
        (term, display_name, note_count, day_count, total_sightings, backlink_max, best_source, best_confidence, best_score, first_seen_at, last_seen_at, promotion_score, updated_at)
      VALUES
        ('widget framework', 'Widget Framework', 10, 8, 30, 5, 'dead_link', 'high', 3, ${now - 30 * 86400000}, ${now}, 60, ${now})
    `);

    const result = await suggestRelatedLinks(
      'We should evaluate Widget Framework and Gadget Library for the new project.',
      { detail: true, maxSuggestions: 10, disabledLayers: ['prospect_boost'] },
    );

    expect(result.detailed).toBeDefined();

    const widget = result.detailed!.find(d => d.entity === 'Widget Framework');
    expect(widget).toBeDefined();
    expect(widget!.breakdown.prospectBoost ?? 0).toBe(0);
  });

  it('boost scales with effective score (effective=30 → boost=3.0)', async () => {
    const now = Date.now();
    // promotion_score=30, just seen → effective=30, boost = min(6, 30/10) = 3.0
    stateDb.db.exec(`
      INSERT INTO prospect_summary
        (term, display_name, note_count, day_count, total_sightings, backlink_max, best_source, best_confidence, best_score, first_seen_at, last_seen_at, promotion_score, updated_at)
      VALUES
        ('widget framework', 'Widget Framework', 5, 4, 10, 3, 'dead_link', 'medium', 0, ${now - 10 * 86400000}, ${now}, 30, ${now})
    `);

    const result = await suggestRelatedLinks(
      'We should evaluate Widget Framework for the new project.',
      { detail: true, maxSuggestions: 10 },
    );

    const widget = result.detailed!.find(d => d.entity === 'Widget Framework');
    expect(widget).toBeDefined();
    expect(widget!.breakdown.prospectBoost).toBeCloseTo(3.0, 0);
  });

  it('stale prospect produces zero boost (effective <= 5)', async () => {
    const now = Date.now();
    // promotion_score=10, 180 days old → effective ~10 * 0.125 = 1.25, below >5 threshold
    const longAgo = now - 180 * 86400000;
    stateDb.db.exec(`
      INSERT INTO prospect_summary
        (term, display_name, note_count, day_count, total_sightings, backlink_max, best_source, best_confidence, best_score, first_seen_at, last_seen_at, promotion_score, updated_at)
      VALUES
        ('widget framework', 'Widget Framework', 3, 2, 5, 1, 'implicit', 'low', 0, ${longAgo}, ${longAgo}, 10, ${longAgo})
    `);

    const result = await suggestRelatedLinks(
      'We should evaluate Widget Framework for the new project.',
      { detail: true, maxSuggestions: 10 },
    );

    const widget = result.detailed!.find(d => d.entity === 'Widget Framework');
    expect(widget).toBeDefined();
    expect(widget!.breakdown.prospectBoost ?? 0).toBe(0);
  });

  it('boost caps at 6 (effective >= 60)', async () => {
    const now = Date.now();
    // promotion_score=200, just seen → effective=200, boost = min(6, 200/10) = 6
    stateDb.db.exec(`
      INSERT INTO prospect_summary
        (term, display_name, note_count, day_count, total_sightings, backlink_max, best_source, best_confidence, best_score, first_seen_at, last_seen_at, promotion_score, updated_at)
      VALUES
        ('widget framework', 'Widget Framework', 10, 10, 50, 10, 'high_score', 'high', 10, ${now - 5 * 86400000}, ${now}, 200, ${now})
    `);

    const result = await suggestRelatedLinks(
      'We should evaluate Widget Framework for the new project.',
      { detail: true, maxSuggestions: 10 },
    );

    const widget = result.detailed!.find(d => d.entity === 'Widget Framework');
    expect(widget).toBeDefined();
    expect(widget!.breakdown.prospectBoost).toBe(6);
  });
});

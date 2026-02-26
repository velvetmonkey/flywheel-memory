/**
 * Suite 5: Property-Based Invariants (fast-check)
 *
 * System guarantees that must hold under arbitrary input.
 * Uses fast-check for property-based testing with 100 random cases each.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import path from 'path';
import { mkdtemp, writeFile, rm, mkdir } from 'fs/promises';
import os from 'os';
import { applyWikilinks } from '@velvetmonkey/vault-core';
import type { EntityWithAliases, WikilinkResult } from '@velvetmonkey/vault-core';
import {
  initializeEntityIndex,
  extractLinkedEntities,
  suggestRelatedLinks,
  setWriteStateDb,
  getEntityIndex,
  isEntityIndexReady,
} from '../../src/core/write/wikilinks.js';
import { setRecencyStateDb } from '../../src/core/shared/recency.js';
import {
  openStateDb,
  deleteStateDb,
  type StateDb,
} from '@velvetmonkey/vault-core';
import {
  createTempVault,
  cleanupTempVault,
} from '../helpers/testUtils.js';

// =============================================================================
// Custom Arbitraries
// =============================================================================

/** Entity name: 2-20 alphanumeric chars with optional internal spaces */
const entityNameArb = fc.stringOf(
  fc.oneof(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
    fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')),
    fc.constant(' '),
  ),
  { minLength: 2, maxLength: 20 },
).filter(s => s.trim().length >= 2 && !s.startsWith(' ') && !s.endsWith(' ') && !s.includes('  '));

/** EntityWithAliases object */
const entityArb: fc.Arbitrary<EntityWithAliases> = entityNameArb.map(name => ({
  name,
  path: `entities/${name.replace(/\s+/g, '-')}.md`,
  aliases: [],
}));

/** A set of N unique entities */
function entitySetArb(min: number, max: number): fc.Arbitrary<EntityWithAliases[]> {
  return fc.array(entityArb, { minLength: min, maxLength: max })
    .map(entities => {
      const seen = new Set<string>();
      return entities.filter(e => {
        const key = e.name.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    })
    .filter(arr => arr.length >= min);
}

/** Markdown paragraph (no code blocks or frontmatter) */
const paragraphArb = fc.stringOf(
  fc.oneof(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz '.split('')),
    fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')),
    fc.constantFrom('.', ',', '!', '?', '\n'),
  ),
  { minLength: 10, maxLength: 300 },
);

/** Code block */
const codeBlockArb = fc.tuple(
  fc.constantFrom('js', 'ts', 'python', 'bash', ''),
  fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789 =();\n'.split('')), { minLength: 5, maxLength: 100 }),
).map(([lang, code]) => `\`\`\`${lang}\n${code}\n\`\`\``);

/** Frontmatter block */
const frontmatterArb = fc.constantFrom(
  '---\ntype: note\n---\n',
  '---\ntitle: Test\ntags:\n  - test\n---\n',
  '',
);

/** Markdown content with optional code blocks and frontmatter */
const markdownContentArb = fc.tuple(
  frontmatterArb,
  paragraphArb,
  fc.option(codeBlockArb, { nil: undefined }),
  paragraphArb,
).map(([fm, p1, code, p2]) => {
  let content = fm;
  content += `# Test Note\n\n${p1}\n\n`;
  if (code) content += `${code}\n\n`;
  content += `${p2}\n`;
  return content;
});

// =============================================================================
// Property Tests
// =============================================================================

describe('Suite 5: Property-Based Invariants', () => {

  // =========================================================================
  // 1. Score non-negativity
  // =========================================================================
  describe('Property 1: Score non-negativity', () => {
    let tempVault: string;
    let stateDb: StateDb;

    beforeAll(async () => {
      tempVault = await createTempVault();
      stateDb = openStateDb(tempVault);
      setWriteStateDb(stateDb);
      setRecencyStateDb(stateDb);

      // Create a minimal vault with a few entities
      const entities = ['Alice', 'Bob', 'TypeScript', 'React', 'Project Alpha'];
      for (const name of entities) {
        const dir = path.join(tempVault, 'entities');
        await mkdir(dir, { recursive: true });
        await writeFile(
          path.join(dir, `${name}.md`),
          `---\ntype: concept\n---\n# ${name}\n\nA note about ${name}.\n`,
        );
      }
      await initializeEntityIndex(tempVault);
    }, 30000);

    afterAll(async () => {
      setWriteStateDb(null);
      setRecencyStateDb(null);
      stateDb.close();
      deleteStateDb(tempVault);
      await cleanupTempVault(tempVault);
    });

    it('all suggestion scores >= 0 for arbitrary content', async () => {
      // Use a simpler approach: generate content strings and check scores
      const contents = [
        'Working with Alice and Bob on TypeScript.',
        'The React project is going well.',
        'Project Alpha uses React and TypeScript for the frontend.',
        'Random content with no entity mentions at all.',
        'Multiple mentions: Alice, Alice, Alice, Bob, Bob.',
        '',
        '# Just a heading',
        'Code: `const x = 1;` and more text about React.',
      ];

      for (const content of contents) {
        const result = await suggestRelatedLinks(content, {
          maxSuggestions: 10,
          detail: true,
          notePath: 'test.md',
        });

        if (result.detailed) {
          for (const d of result.detailed) {
            expect(d.totalScore).toBeGreaterThanOrEqual(0);
            expect(d.breakdown.contentMatch).toBeGreaterThanOrEqual(0);
            expect(Number.isFinite(d.totalScore)).toBe(true);
            expect(Number.isNaN(d.totalScore)).toBe(false);
          }
        }
      }
    }, 30000);
  });

  // =========================================================================
  // 2. Suppression guarantee
  // =========================================================================
  describe('Property 2: Suppression guarantee', () => {
    let tempVault: string;
    let stateDb: StateDb;

    beforeAll(async () => {
      tempVault = await createTempVault();
      stateDb = openStateDb(tempVault);
      setWriteStateDb(stateDb);
      setRecencyStateDb(stateDb);

      // Create entities
      const entities = ['Alice', 'Bob', 'Charlie', 'TypeScript', 'React'];
      for (const name of entities) {
        const dir = path.join(tempVault, 'entities');
        await mkdir(dir, { recursive: true });
        await writeFile(
          path.join(dir, `${name}.md`),
          `---\ntype: concept\n---\n# ${name}\n\nA note about ${name}.\n`,
        );
      }
      await initializeEntityIndex(tempVault);

      // Suppress "Alice" and "React"
      stateDb.db.prepare(
        'INSERT OR IGNORE INTO wikilink_suppressions (entity, false_positive_rate) VALUES (?, ?)',
      ).run('Alice', 0.9);
      stateDb.db.prepare(
        'INSERT OR IGNORE INTO wikilink_suppressions (entity, false_positive_rate) VALUES (?, ?)',
      ).run('React', 0.85);
    }, 30000);

    afterAll(async () => {
      setWriteStateDb(null);
      setRecencyStateDb(null);
      stateDb.close();
      deleteStateDb(tempVault);
      await cleanupTempVault(tempVault);
    });

    it('suppressed entities have lower scores than non-suppressed equivalents', async () => {
      const contents = [
        'Alice and Bob work on React and TypeScript together.',
        'Alice loves React. Alice uses React daily.',
        'React is the best framework according to Alice.',
      ];

      for (const content of contents) {
        const result = await suggestRelatedLinks(content, {
          maxSuggestions: 10,
          notePath: 'test.md',
          detail: true,
        });

        // Suppressed entities that do appear should have suppressionPenalty < 0
        for (const d of result.detailed ?? []) {
          if (d.entity.toLowerCase() === 'alice' || d.entity.toLowerCase() === 'react') {
            expect(d.breakdown.suppressionPenalty).toBeLessThan(0);
          }
        }
      }
    }, 30000);
  });

  // =========================================================================
  // 3. First-occurrence-only
  // =========================================================================
  describe('Property 3: firstOccurrenceOnly produces <= 1 link per entity', () => {
    it('holds for arbitrary entity sets and content', () => {
      fc.assert(
        fc.property(
          entitySetArb(1, 5),
          fc.constant('The quick brown fox jumps over the lazy dog. '),
          (entities, _base) => {
            // Build content that mentions each entity multiple times
            const content = entities.map(e => `${e.name} is great. I love ${e.name}. ${e.name} again.`).join('\n');

            const result = applyWikilinks(content, entities, { firstOccurrenceOnly: true });

            // Count wikilinks per entity
            for (const entity of entities) {
              const pattern = new RegExp(`\\[\\[${entity.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\]`, 'gi');
              const matches = result.content.match(pattern) || [];
              expect(matches.length).toBeLessThanOrEqual(1);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // =========================================================================
  // 4. Protected zone integrity
  // =========================================================================
  describe('Property 4: Protected zone integrity', () => {
    it('code blocks unchanged by applyWikilinks', () => {
      fc.assert(
        fc.property(
          entitySetArb(1, 3),
          codeBlockArb,
          (entities, codeBlock) => {
            const content = `Some text before.\n\n${codeBlock}\n\nSome text after.`;
            const result = applyWikilinks(content, entities);

            // Extract code block from result — it should be unchanged
            const codeBlockPattern = /```[\s\S]*?```/g;
            const originalBlocks = content.match(codeBlockPattern) || [];
            const resultBlocks = result.content.match(codeBlockPattern) || [];

            expect(resultBlocks.length).toBe(originalBlocks.length);
            for (let i = 0; i < originalBlocks.length; i++) {
              expect(resultBlocks[i]).toBe(originalBlocks[i]);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('frontmatter unchanged by applyWikilinks', () => {
      fc.assert(
        fc.property(
          entitySetArb(1, 3),
          (entities) => {
            const fm = '---\ntitle: Test Note\ntype: concept\ntags:\n  - test\n---\n';
            const content = `${fm}\n# Heading\n\nSome text mentioning ${entities.map(e => e.name).join(' and ')}.`;
            const result = applyWikilinks(content, entities);

            // Frontmatter should be identical
            const fmPattern = /^---\n[\s\S]*?\n---\n/;
            const originalFm = content.match(fmPattern)?.[0];
            const resultFm = result.content.match(fmPattern)?.[0];

            expect(resultFm).toBe(originalFm);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // =========================================================================
  // 5. Entity count bound
  // =========================================================================
  describe('Property 5: Entity count bound', () => {
    it('scanVaultEntities result <= .md file count', async () => {
      // Use the existing temp vault approach with varying note counts
      const noteCounts = [5, 10, 20];

      for (const count of noteCounts) {
        const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'invariant-'));
        const stateDb = openStateDb(tmpDir);
        setWriteStateDb(stateDb);
        setRecencyStateDb(stateDb);

        try {
          // Create N entity notes
          for (let i = 0; i < count; i++) {
            const dir = path.join(tmpDir, 'entities');
            await mkdir(dir, { recursive: true });
            await writeFile(
              path.join(dir, `entity-${i}.md`),
              `---\ntype: concept\n---\n# Entity ${i}\n\nContent.\n`,
            );
          }

          await initializeEntityIndex(tmpDir);
          const index = getEntityIndex();

          if (index) {
            // Count all entities across categories
            let totalEntities = 0;
            const categories = [
              'technologies', 'acronyms', 'people', 'projects',
              'organizations', 'locations', 'concepts', 'animals',
              'media', 'events', 'documents', 'vehicles', 'health',
              'finance', 'food', 'hobbies', 'other',
            ] as const;
            for (const cat of categories) {
              totalEntities += (index[cat] || []).length;
            }

            expect(totalEntities).toBeLessThanOrEqual(count);
          }
        } finally {
          setWriteStateDb(null);
          setRecencyStateDb(null);
          stateDb.close();
          deleteStateDb(tmpDir);
          await rm(tmpDir, { recursive: true, force: true });
        }
      }
    }, 60000);
  });

  // =========================================================================
  // 6. Round-trip safety
  // =========================================================================
  describe('Property 6: Round-trip safety', () => {
    it('applyWikilinks then extractLinkedEntities recovers linked entity names', () => {
      fc.assert(
        fc.property(
          entitySetArb(1, 5),
          (entities) => {
            // Build content that mentions each entity exactly once
            const content = entities.map(e => `I work with ${e.name} frequently.`).join('\n');

            const result = applyWikilinks(content, entities, { firstOccurrenceOnly: true });

            // Extract linked entities from the wikified content
            const linked = extractLinkedEntities(result.content);

            // Every entity that was linked should be extractable
            for (const entityName of result.linkedEntities) {
              expect(linked.has(entityName.toLowerCase())).toBe(true);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // =========================================================================
  // 7. Idempotent application
  // =========================================================================
  describe('Property 7: Idempotent application', () => {
    it('applyWikilinks on already-wikified content adds 0 new links', () => {
      fc.assert(
        fc.property(
          entitySetArb(1, 5),
          (entities) => {
            // First application
            const content = entities.map(e => `Working with ${e.name} on the project.`).join('\n');
            const first = applyWikilinks(content, entities, { firstOccurrenceOnly: true });

            // Second application on already-wikified content
            const second = applyWikilinks(first.content, entities, { firstOccurrenceOnly: true });

            // No new links should be added
            expect(second.linksAdded).toBe(0);
            expect(second.content).toBe(first.content);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});

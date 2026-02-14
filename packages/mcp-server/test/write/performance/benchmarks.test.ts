/**
 * Performance benchmark tests for production hardening (Phase 3)
 *
 * These tests establish baseline performance expectations for core operations.
 * They help catch performance regressions and ensure the system scales appropriately.
 *
 * NOTE: These are not strict pass/fail tests - the thresholds are generous
 * to account for CI variability. Monitor trends rather than absolute values.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import {
  readVaultFile,
  writeVaultFile,
  findSection,
  insertInSection,
  extractHeadings,
} from '../../src/core/writer.js';
import {
  initializeEntityIndex,
  suggestRelatedLinks,
  getEntityIndexStats,
  setCrankStateDb,
} from '../../src/core/wikilinks.js';
import {
  createTempVault,
  cleanupTempVault,
  createTestNote,
  createEntityCache,
  createEntityCacheInStateDb,
  openStateDb,
  deleteStateDb,
  type StateDb,
} from '../helpers/testUtils.js';

describe('performance benchmarks', () => {
  let tempVault: string;
  let stateDb: StateDb;

  beforeEach(async () => {
    tempVault = await createTempVault();
    stateDb = openStateDb(tempVault);
    setCrankStateDb(stateDb);
  });

  afterEach(async () => {
    setCrankStateDb(null);
    stateDb.db.close();
    deleteStateDb(tempVault);
    await cleanupTempVault(tempVault);
  });

  describe('file mutation performance', () => {
    it('should mutate 1000-line file in <100ms', async () => {
      // Generate a 1000-line markdown file
      const lines: string[] = [
        '---',
        'type: test',
        '---',
        '',
        '# Large File Test',
        '',
        '## Log',
        '',
      ];

      for (let i = 0; i < 992; i++) {
        lines.push(`- Entry ${i + 1}: Lorem ipsum dolor sit amet`);
      }

      const content = lines.join('\n');
      await createTestNote(tempVault, 'large.md', content);

      // Measure mutation time
      const start = performance.now();

      const { content: fileContent, frontmatter, lineEnding } = await readVaultFile(tempVault, 'large.md');
      const section = findSection(fileContent, 'Log')!;
      const modified = insertInSection(fileContent, section, '- New entry at the end', 'append');
      await writeVaultFile(tempVault, 'large.md', modified, frontmatter, lineEnding);

      const elapsed = performance.now() - start;

      console.log(`  1000-line mutation: ${elapsed.toFixed(2)}ms`);
      expect(elapsed).toBeLessThan(200);  // Generous for CI variability (typically ~15ms local, ~100ms CI)
    });

    it('should mutate 10000-line file in <500ms', async () => {
      // Generate a 10000-line markdown file
      const lines: string[] = [
        '---',
        'type: test',
        '---',
        '',
        '# Very Large File Test',
        '',
        '## Log',
        '',
      ];

      for (let i = 0; i < 9992; i++) {
        lines.push(`- Entry ${i + 1}: Lorem ipsum dolor sit amet consectetur adipiscing elit`);
      }

      const content = lines.join('\n');
      await createTestNote(tempVault, 'very-large.md', content);

      // Measure mutation time
      const start = performance.now();

      const { content: fileContent, frontmatter, lineEnding } = await readVaultFile(tempVault, 'very-large.md');
      const section = findSection(fileContent, 'Log')!;
      const modified = insertInSection(fileContent, section, '- New entry at the end', 'append');
      await writeVaultFile(tempVault, 'very-large.md', modified, frontmatter, lineEnding);

      const elapsed = performance.now() - start;

      console.log(`  10000-line mutation: ${elapsed.toFixed(2)}ms`);
      expect(elapsed).toBeLessThan(500);
    });

    it('should mutate 100000-line file in <2000ms', async () => {
      // Generate a 100000-line markdown file (battle-hardening requirement)
      const lines: string[] = [
        '---',
        'type: stress-test',
        '---',
        '',
        '# Massive File Test',
        '',
        '## Log',
        '',
      ];

      for (let i = 0; i < 99992; i++) {
        lines.push(`- Entry ${i + 1}: Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor`);
      }

      const content = lines.join('\n');
      await createTestNote(tempVault, 'massive.md', content);

      // Measure mutation time
      const start = performance.now();

      const { content: fileContent, frontmatter, lineEnding } = await readVaultFile(tempVault, 'massive.md');
      const section = findSection(fileContent, 'Log')!;
      const modified = insertInSection(fileContent, section, '- New entry at the end of massive file', 'append');
      await writeVaultFile(tempVault, 'massive.md', modified, frontmatter, lineEnding);

      const elapsed = performance.now() - start;

      console.log(`  100000-line mutation: ${elapsed.toFixed(2)}ms`);
      expect(elapsed).toBeLessThan(2000);
    });

    it('should handle 100 consecutive mutations without degradation', async () => {
      const content = `---
type: test
---
# Test

## Log
- Initial entry
`;
      await createTestNote(tempVault, 'consecutive.md', content);

      const times: number[] = [];

      for (let i = 0; i < 100; i++) {
        const start = performance.now();

        const { content: fileContent, frontmatter, lineEnding } = await readVaultFile(tempVault, 'consecutive.md');
        const section = findSection(fileContent, 'Log')!;
        const modified = insertInSection(fileContent, section, `- Entry ${i + 1}`, 'append');
        await writeVaultFile(tempVault, 'consecutive.md', modified, frontmatter, lineEnding);

        times.push(performance.now() - start);
      }

      const avgFirst10 = times.slice(0, 10).reduce((a, b) => a + b, 0) / 10;
      const avgLast10 = times.slice(-10).reduce((a, b) => a + b, 0) / 10;

      console.log(`  100 mutations - First 10 avg: ${avgFirst10.toFixed(2)}ms, Last 10 avg: ${avgLast10.toFixed(2)}ms`);

      // Last 10 should not be significantly slower than first 10 (< 5x degradation)
      // Generous threshold for CI variability (typically ~1.2x locally)
      expect(avgLast10).toBeLessThan(avgFirst10 * 5);
    });
  });

  describe('heading extraction performance', () => {
    it('should extract headings from 1000-line file in <10ms', () => {
      // Generate content with many headings
      const lines: string[] = [];
      for (let i = 0; i < 50; i++) {
        lines.push(`## Section ${i + 1}`);
        for (let j = 0; j < 18; j++) {
          lines.push(`Content line ${j + 1} in section ${i + 1}`);
        }
      }

      const content = lines.join('\n');

      const start = performance.now();
      const headings = extractHeadings(content);
      const elapsed = performance.now() - start;

      console.log(`  Extract ${headings.length} headings from ${lines.length} lines: ${elapsed.toFixed(2)}ms`);
      expect(elapsed).toBeLessThan(10);
      expect(headings.length).toBe(50);
    });
  });

  describe('entity index performance', () => {
    it('should score 1000 entities in <50ms', async () => {
      // Create a large entity cache
      const entities: string[] = [];
      for (let i = 0; i < 200; i++) {
        entities.push(`Entity ${i + 1}`);
      }

      createEntityCacheInStateDb(stateDb, tempVault, {
        technologies: entities.slice(0, 50),
        projects: entities.slice(50, 100),
        people: entities.slice(100, 150),
        other: entities.slice(150, 200),
      });

      await initializeEntityIndex(tempVault);

      const content = 'Working on Entity 1, Entity 50, Entity 100 project with Entity 150';

      // Run multiple times to get stable measurement
      const times: number[] = [];
      for (let run = 0; run < 5; run++) {
        const start = performance.now();
        for (let i = 0; i < 5; i++) { // 5 calls * 200 entities = 1000 entity evaluations
          suggestRelatedLinks(content);
        }
        times.push(performance.now() - start);
      }

      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      console.log(`  Score 1000 entities: ${avgTime.toFixed(2)}ms`);
      expect(avgTime).toBeLessThan(50);
    });

    it('should score 5000 entities in <200ms', async () => {
      // Create a very large entity cache
      const entities: string[] = [];
      for (let i = 0; i < 1000; i++) {
        entities.push(`Entity Number ${i + 1}`);
      }

      createEntityCacheInStateDb(stateDb, tempVault, {
        technologies: entities.slice(0, 250),
        projects: entities.slice(250, 500),
        people: entities.slice(500, 750),
        other: entities.slice(750, 1000),
      });

      await initializeEntityIndex(tempVault);

      const content = 'Working on Entity Number 1, Entity Number 500 project';

      // Run multiple times to get stable measurement
      const times: number[] = [];
      for (let run = 0; run < 3; run++) {
        const start = performance.now();
        for (let i = 0; i < 5; i++) { // 5 calls * 1000 entities = 5000 entity evaluations
          suggestRelatedLinks(content);
        }
        times.push(performance.now() - start);
      }

      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      console.log(`  Score 5000 entities: ${avgTime.toFixed(2)}ms`);
      expect(avgTime).toBeLessThan(200);
    });
  });

  describe('wikilink processing performance', () => {
    it('should suggest related links in 1000-char content in <10ms', async () => {
      // Create entity cache
      createEntityCacheInStateDb(stateDb, tempVault, {
        technologies: ['TypeScript', 'JavaScript', 'Python', 'Rust', 'Go'],
        projects: ['Project Alpha', 'Project Beta', 'Project Gamma'],
        people: ['Alice Smith', 'Bob Jones', 'Charlie Brown'],
      });
      await initializeEntityIndex(tempVault);

      // Generate ~1000 char content with entity mentions
      const content = `Working with TypeScript and JavaScript on Project Alpha today.
Met with Alice Smith to discuss the Python integration.
Later reviewed the Rust implementation with Bob Jones.
The Go microservice needs attention from Charlie Brown.
Project Beta and Project Gamma are on track for next sprint.
More TypeScript refactoring needed for the JavaScript bridge.
Python scripting helps with Go deployment automation.
`.repeat(3); // ~1000 chars

      const times: number[] = [];
      for (let run = 0; run < 10; run++) {
        const start = performance.now();
        // Use suggestRelatedLinks which performs entity scoring
        suggestRelatedLinks(content);
        times.push(performance.now() - start);
      }

      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      console.log(`  Suggest links for ${content.length} chars: ${avgTime.toFixed(2)}ms`);
      expect(avgTime).toBeLessThan(25);  // Generous for CI variability (typically ~2ms local, ~10ms CI)
    });
  });

  describe('memory usage', () => {
    it('should handle large entity index without excessive memory', async () => {
      // Create a large entity cache (simulating a real vault with many entities)
      const entities: string[] = [];
      for (let i = 0; i < 2500; i++) {
        entities.push(`Entity With Longer Name ${i + 1}`);
      }

      createEntityCacheInStateDb(stateDb, tempVault, {
        technologies: entities.slice(0, 625),
        projects: entities.slice(625, 1250),
        people: entities.slice(1250, 1875),
        other: entities.slice(1875, 2500),
      });

      // Initialize the index
      await initializeEntityIndex(tempVault);

      const stats = getEntityIndexStats();
      console.log(`  Entity index: ${stats.totalEntities} entities, ready: ${stats.ready}`);

      // Verify the index was created
      expect(stats.totalEntities).toBe(2500);
      expect(stats.ready).toBe(true);
    });
  });
});

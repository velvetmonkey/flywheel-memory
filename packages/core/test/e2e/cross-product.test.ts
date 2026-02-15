/**
 * Cross-Product Integration Tests
 *
 * Validates the full flywheel loop:
 * vault-core scans → flywheel reads → flywheel memory writes → verify graph updated
 *
 * These tests ensure that shared utilities work correctly across the ecosystem.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  openStateDb,
  deleteStateDb,
  stateDbExists,
  searchEntities,
  searchEntitiesPrefix,
  getEntityByName,
  getAllEntitiesFromDb,
  getEntityIndexFromDb,
  recordEntityMention,
  getEntityRecency,
  scanVaultEntities,
  applyWikilinks,
  suggestWikilinks,
  getAllEntities,
  saveEntityCache,
  loadEntityCache,
  getProtectedZones,
  type StateDb,
  type EntityIndex,
  type EntityWithAliases,
} from '../../src/index.js';

describe('Cross-Product Integration', () => {
  let testVaultPath: string;
  let stateDb: StateDb;

  beforeEach(() => {
    testVaultPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cross-product-test-'));
  });

  afterEach(() => {
    if (stateDb) {
      stateDb.close();
    }
    if (fs.existsSync(testVaultPath)) {
      fs.rmSync(testVaultPath, { recursive: true });
    }
  });

  describe('Full Flywheel Loop', () => {
    it('should scan → index → apply wikilinks → verify graph updated', async () => {
      // Step 1: Create a vault structure
      const vaultStructure = {
        'people/Jordan Smith.md': `---
type: person
aliases:
  - Jordan
---
# Jordan Smith

Senior engineer working on Artemis Launch Project project.
`,
        'projects/Artemis Launch Project.md': `---
type: project
status: active
---
# Artemis Launch Project

Implementation led by Jordan.
`,
        'daily-notes/2026-02-02.md': `---
type: daily
date: 2026-02-02
---
# 2026-02-02

## Log

- Met with Jordan Smith to discuss Artemis Launch Project progress
- The Artemis Launch Project milestone is on track
`,
      };

      // Write vault files
      for (const [filePath, content] of Object.entries(vaultStructure)) {
        const fullPath = path.join(testVaultPath, filePath);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, content, 'utf-8');
      }

      // Step 2: Scan entities (simulates flywheel initialization)
      const scannedEntities = await scanVaultEntities(testVaultPath, {
        includeAliases: true,
      });

      expect(scannedEntities._metadata.total_entities).toBeGreaterThanOrEqual(2);
      expect(scannedEntities.people.some(p => p.name === 'Jordan Smith')).toBe(true);
      expect(scannedEntities.projects.some(p => p.name === 'Artemis Launch Project')).toBe(true);

      // Step 3: Store in SQLite StateDb (shared persistence)
      stateDb = openStateDb(testVaultPath);
      const insertCount = stateDb.replaceAllEntities(scannedEntities);

      expect(insertCount).toBeGreaterThanOrEqual(2);

      // Step 4: Apply wikilinks (simulates flywheel memory write)
      const dailyNoteContent = fs.readFileSync(
        path.join(testVaultPath, 'daily-notes/2026-02-02.md'),
        'utf-8'
      );

      const allEntities = getAllEntities(scannedEntities);
      const wikilinkResult = applyWikilinks(dailyNoteContent, allEntities);
      const withWikilinks = wikilinkResult.content;

      // Verify wikilinks were applied
      expect(withWikilinks).toContain('[[Jordan Smith]]');
      expect(withWikilinks).toContain('[[Artemis Launch Project]]');

      // Step 5: Write back
      fs.writeFileSync(
        path.join(testVaultPath, 'daily-notes/2026-02-02.md'),
        withWikilinks,
        'utf-8'
      );
    });

    it('should maintain entity recency across products', async () => {
      stateDb = openStateDb(testVaultPath);

      // Record mentions (simulates flywheel memory tracking context relevance)
      const now = new Date();
      recordEntityMention(stateDb, 'TypeScript', now);
      recordEntityMention(stateDb, 'React', new Date(now.getTime() - 1000));
      recordEntityMention(stateDb, 'TypeScript', now); // Second mention

      // Query recency (simulates flywheel suggesting relevant entities)
      const tsRecency = getEntityRecency(stateDb, 'TypeScript');
      expect(tsRecency).not.toBeNull();
      expect(tsRecency!.mentionCount).toBe(2);

      const reactRecency = getEntityRecency(stateDb, 'React');
      expect(reactRecency).not.toBeNull();
      expect(reactRecency!.mentionCount).toBe(1);
    });
  });

  describe('Entity Cache Consistency', () => {
    it('should add entity via cache → rescan → both products see it', async () => {
      // Create initial vault
      const initialNote = `---
type: person
---
# Alice Chen

Software engineer.
`;
      fs.mkdirSync(path.join(testVaultPath, 'people'), { recursive: true });
      fs.writeFileSync(path.join(testVaultPath, 'people/Alice Chen.md'), initialNote, 'utf-8');

      // Scan and save cache
      const entities1 = await scanVaultEntities(testVaultPath);
      const cachePath = path.join(testVaultPath, '.claude', 'entity-cache.json');
      await saveEntityCache(cachePath, entities1);

      expect(entities1.people.some(p => p.name === 'Alice Chen')).toBe(true);

      // Add new entity file (simulates flywheel memory creating a note)
      const newNote = `---
type: person
---
# Bob Wilson

Product manager.
`;
      fs.writeFileSync(path.join(testVaultPath, 'people/Bob Wilson.md'), newNote, 'utf-8');

      // Rescan (simulates index refresh)
      const entities2 = await scanVaultEntities(testVaultPath);

      expect(entities2.people.some(p => p.name === 'Alice Chen')).toBe(true);
      expect(entities2.people.some(p => p.name === 'Bob Wilson')).toBe(true);
      expect(entities2._metadata.total_entities).toBe(entities1._metadata.total_entities + 1);

      // Store in StateDb
      stateDb = openStateDb(testVaultPath);
      stateDb.replaceAllEntities(entities2);

      // Both search and direct lookup should find both
      const aliceResult = getEntityByName(stateDb, 'Alice Chen');
      expect(aliceResult).not.toBeNull();

      const bobResult = getEntityByName(stateDb, 'Bob Wilson');
      expect(bobResult).not.toBeNull();

      // FTS5 search should find both
      const personResults = searchEntities(stateDb, 'people');
      expect(personResults.length).toBe(2);
    });

    it('should handle entity aliases across scan and lookup', async () => {
      const entityNote = `---
type: technology
aliases:
  - TS
  - TypeScript Language
---
# TypeScript

Typed JavaScript.
`;
      fs.mkdirSync(path.join(testVaultPath, 'technologies'), { recursive: true });
      fs.writeFileSync(path.join(testVaultPath, 'technologies/TypeScript.md'), entityNote, 'utf-8');

      // Scan with aliases
      const entities = await scanVaultEntities(testVaultPath, { includeAliases: true });

      const tsEntity = entities.technologies.find(e => e.name === 'TypeScript');
      expect(tsEntity).toBeDefined();
      expect(tsEntity!.aliases).toContain('TS');
      expect(tsEntity!.aliases).toContain('TypeScript Language');

      // Store in StateDb
      stateDb = openStateDb(testVaultPath);
      stateDb.replaceAllEntities(entities);

      // Lookup should return aliases
      const result = getEntityByName(stateDb, 'TypeScript');
      expect(result).not.toBeNull();
      expect(result!.aliases).toContain('TS');

      // FTS search should match alias text
      const aliasResults = searchEntities(stateDb, 'TS');
      expect(aliasResults.some(r => r.name === 'TypeScript')).toBe(true);

      // applyWikilinks should match via alias (uses piped format)
      const allEntities = getAllEntities(entities);
      const wikilinkResult = applyWikilinks('Working with TS today', allEntities);
      expect(wikilinkResult.content).toContain('[[TypeScript|TS]]');
    });
  });

  describe('Protected Zones Integration', () => {
    it('should respect protected zones when applying wikilinks', () => {
      const content = `---
title: TypeScript Guide
author: Jordan Smith
---
# TypeScript Guide

TypeScript is great. See [Jordan Smith on GitHub](https://github.com/jordan).

\`\`\`typescript
// Jordan Smith wrote this code
const TypeScript = 'best language';
\`\`\`

Jordan Smith recommends TypeScript for all projects.
`;

      const entities: EntityWithAliases[] = [
        { name: 'Jordan Smith', path: 'people/Jordan Smith.md', aliases: [] },
        { name: 'TypeScript', path: 'tech/TypeScript.md', aliases: [] },
      ];

      // Apply wikilinks
      const result = applyWikilinks(content, entities).content;

      // Should link in body text
      expect(result).toContain('[[Jordan Smith]] recommends');
      expect(result).toContain('[[TypeScript]] is great');

      // Should NOT link in frontmatter
      expect(result).toContain('author: Jordan Smith');
      expect(result).not.toContain('author: [[Jordan Smith]]');

      // Should NOT link in code blocks
      expect(result).toContain('// Jordan Smith wrote this code');
      expect(result).not.toContain('// [[Jordan Smith]]');

      // Should NOT link inside markdown links
      expect(result).toContain('[Jordan Smith on GitHub]');
    });

    it('should detect all protected zone types', () => {
      const content = `---
frontmatter: here
---
# Title

Regular text with \`inline code\` and more.

\`\`\`js
code block
\`\`\`

> Blockquote text

[Link text](url)

[[Existing Wikilink]]

$$math$$
`;

      const zones = getProtectedZones(content);

      const zoneTypes = zones.map(z => z.type);
      expect(zoneTypes).toContain('frontmatter');
      expect(zoneTypes).toContain('inline_code');
      expect(zoneTypes).toContain('code_block');
      expect(zoneTypes).toContain('markdown_link');
      expect(zoneTypes).toContain('wikilink');
      expect(zoneTypes).toContain('math');
    });
  });

  describe('StateDb Round-Trip', () => {
    it('should convert EntityIndex → StateDb → EntityIndex with fidelity', async () => {
      const originalIndex: EntityIndex = {
        technologies: [
          { name: 'TypeScript', path: 'tech/typescript.md', aliases: ['TS'] },
          { name: 'React', path: 'tech/react.md', aliases: ['ReactJS'] },
        ],
        people: [
          { name: 'Jordan Smith', path: 'people/jordan.md', aliases: ['JS'] },
        ],
        projects: [
          { name: 'Artemis Launch Project', path: 'projects/mcp.md', aliases: [] },
        ],
        acronyms: [],
        organizations: [],
        locations: [],
        concepts: [],
        other: [],
        _metadata: {
          total_entities: 4,
          generated_at: new Date().toISOString(),
          vault_path: testVaultPath,
          source: 'test',
        },
      };

      // Store
      stateDb = openStateDb(testVaultPath);
      stateDb.replaceAllEntities(originalIndex);

      // Retrieve
      const retrievedIndex = getEntityIndexFromDb(stateDb);

      // Verify structure
      expect(retrievedIndex.technologies.length).toBe(2);
      expect(retrievedIndex.people.length).toBe(1);
      expect(retrievedIndex.projects.length).toBe(1);
      expect(retrievedIndex._metadata.total_entities).toBe(4);

      // Verify entity details
      const ts = retrievedIndex.technologies.find(e => e.name === 'TypeScript');
      expect(ts).toBeDefined();
      expect(ts!.path).toBe('tech/typescript.md');
      expect(ts!.aliases).toContain('TS');
    });

    it('should handle empty categories gracefully', async () => {
      const sparseIndex: EntityIndex = {
        technologies: [],
        people: [{ name: 'Solo Person', path: 'people/solo.md', aliases: [] }],
        projects: [],
        acronyms: [],
        organizations: [],
        locations: [],
        concepts: [],
        other: [],
        _metadata: {
          total_entities: 1,
          generated_at: new Date().toISOString(),
          vault_path: testVaultPath,
          source: 'test',
        },
      };

      stateDb = openStateDb(testVaultPath);
      stateDb.replaceAllEntities(sparseIndex);

      const retrieved = getEntityIndexFromDb(stateDb);
      expect(retrieved.technologies).toEqual([]);
      expect(retrieved.people.length).toBe(1);
      expect(retrieved._metadata.total_entities).toBe(1);
    });
  });

  describe('Performance Under Load', () => {
    it('should handle 500 entities efficiently', async () => {
      stateDb = openStateDb(testVaultPath);

      // Generate 500 entities (use names that don't get stemmed by Porter)
      const entities: EntityWithAliases[] = Array.from({ length: 500 }, (_, i) => ({
        name: `TestItem${i}`,
        path: `entities/testitem${i}.md`,
        aliases: [`TI${i}`],
        hubScore: Math.floor(Math.random() * 100),
      }));

      const startInsert = performance.now();
      const count = stateDb.bulkInsertEntities(entities, 'concepts');
      const insertDuration = performance.now() - startInsert;

      expect(count).toBe(500);
      expect(insertDuration).toBeLessThan(500); // Should complete in under 500ms

      // Search should be fast (use prefix search for FTS5)
      const startSearch = performance.now();
      const results = searchEntitiesPrefix(stateDb, 'TestItem');
      const searchDuration = performance.now() - startSearch;

      expect(results.length).toBeGreaterThan(0);
      expect(searchDuration).toBeLessThan(50); // Should complete in under 50ms
    });

    it('should apply wikilinks to large content efficiently', () => {
      // Generate large content with many potential matches
      const lines: string[] = [];
      for (let i = 0; i < 100; i++) {
        lines.push(`Line ${i}: TypeScript and React are great. Jordan Smith agrees.`);
      }
      const content = lines.join('\n');

      const entities: EntityWithAliases[] = [
        { name: 'TypeScript', path: 'tech/ts.md', aliases: [] },
        { name: 'React', path: 'tech/react.md', aliases: [] },
        { name: 'Jordan Smith', path: 'people/jordan.md', aliases: [] },
      ];

      const startApply = performance.now();
      const result = applyWikilinks(content, entities).content;
      const applyDuration = performance.now() - startApply;

      expect(result).toContain('[[TypeScript]]');
      expect(result).toContain('[[React]]');
      expect(result).toContain('[[Jordan Smith]]');
      expect(applyDuration).toBeLessThan(100); // Should complete in under 100ms
    });
  });
});

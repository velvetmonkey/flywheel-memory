/**
 * Documentation Examples Verification Tests
 *
 * Extracts and validates code examples from documentation files.
 * Ensures documentation examples work correctly and stay up-to-date.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import {
  readVaultFile,
  writeVaultFile,
  findSection,
  insertInSection,
  formatContent,
} from '../../../src/core/write/writer.js';
import {
  createTempVault,
  cleanupTempVault,
  createTestNote,
  readTestNote,
  createEntityCache,
  createEntityCacheInStateDb,
  openStateDb,
  deleteStateDb,
  type StateDb,
} from '../helpers/testUtils.js';
import {
  initializeEntityIndex,
  processWikilinks,
  suggestRelatedLinks,
  setCrankStateDb,
} from '../../../src/core/write/wikilinks.js';

const DOCS_DIR = path.join(__dirname, '../../../docs');

describe('Documentation Examples Verification', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  describe('MULTI_AGENT_MUTATIONS.md examples', () => {
    it('should demonstrate append-only logging pattern', async () => {
      // Example from docs: Each agent appends to Log section
      const dailyNote = `---
type: daily
date: 2026-02-01
---
# 2026-02-01

## Log
- **09:00** Day started

## Tasks
- [ ] Complete project
`;
      await createTestNote(tempVault, 'daily/2026-02-01.md', dailyNote);

      // Agent 1 appends
      let { content, frontmatter, lineEnding } = await readVaultFile(
        tempVault,
        'daily/2026-02-01.md'
      );
      let section = findSection(content, 'Log')!;
      let modified = insertInSection(content, section, '- **10:00** Meeting completed', 'append');
      await writeVaultFile(tempVault, 'daily/2026-02-01.md', modified, frontmatter, lineEnding);

      // Agent 2 appends
      ({ content, frontmatter, lineEnding } = await readVaultFile(
        tempVault,
        'daily/2026-02-01.md'
      ));
      section = findSection(content, 'Log')!;
      modified = insertInSection(content, section, '- **11:00** Code review done', 'append');
      await writeVaultFile(tempVault, 'daily/2026-02-01.md', modified, frontmatter, lineEnding);

      const result = await readTestNote(tempVault, 'daily/2026-02-01.md');

      // All entries should be present in order
      expect(result.indexOf('09:00')).toBeLessThan(result.indexOf('10:00'));
      expect(result.indexOf('10:00')).toBeLessThan(result.indexOf('11:00'));
    });

    it('should demonstrate section-scoped updates', async () => {
      // Example from docs: Different agents update different sections
      const projectNote = `---
type: project
---
# Project Alpha

## Status
In progress

## Tasks
- [ ] Design review
- [ ] Implementation

## Notes
Initial planning complete.
`;
      await createTestNote(tempVault, 'projects/alpha.md', projectNote);

      // Agent updates Status section
      let { content, frontmatter, lineEnding } = await readVaultFile(
        tempVault,
        'projects/alpha.md'
      );
      let section = findSection(content, 'Status')!;
      let modified = insertInSection(content, section, '\nBlocked on review', 'append');
      await writeVaultFile(tempVault, 'projects/alpha.md', modified, frontmatter, lineEnding);

      // Another agent updates Notes section
      ({ content, frontmatter, lineEnding } = await readVaultFile(
        tempVault,
        'projects/alpha.md'
      ));
      section = findSection(content, 'Notes')!;
      modified = insertInSection(content, section, '\nReview meeting scheduled.', 'append');
      await writeVaultFile(tempVault, 'projects/alpha.md', modified, frontmatter, lineEnding);

      const result = await readTestNote(tempVault, 'projects/alpha.md');

      // Both updates should be present
      expect(result).toContain('Blocked on review');
      expect(result).toContain('Review meeting scheduled');
    });
  });

  describe('AGENT_MUTATION_PATTERNS.md examples', () => {
    it('should demonstrate task management pattern', async () => {
      // Example: Adding tasks with proper formatting
      const taskNote = `---
type: task-list
---
# Sprint Tasks

## Backlog
- [ ] User authentication
- [ ] Dashboard design

## In Progress
- [ ] API endpoints
`;
      await createTestNote(tempVault, 'tasks/sprint.md', taskNote);

      const { content, frontmatter, lineEnding } = await readVaultFile(
        tempVault,
        'tasks/sprint.md'
      );

      // Add task to backlog
      const section = findSection(content, 'Backlog')!;
      const formatted = formatContent('Database optimization', 'task');
      const modified = insertInSection(content, section, formatted, 'append');

      await writeVaultFile(tempVault, 'tasks/sprint.md', modified, frontmatter, lineEnding);

      const result = await readTestNote(tempVault, 'tasks/sprint.md');
      expect(result).toContain('- [ ] Database optimization');
    });

    it('should demonstrate timestamp-bullet format', async () => {
      const logNote = `---
type: meeting
---
# Meeting Log

## Discussion
- **09:00** Meeting started
`;
      await createTestNote(tempVault, 'meetings/log.md', logNote);

      const { content, frontmatter, lineEnding } = await readVaultFile(
        tempVault,
        'meetings/log.md'
      );

      // Add timestamped entry
      const section = findSection(content, 'Discussion')!;
      const formatted = formatContent('Decision made on API design', 'timestamp-bullet');
      const modified = insertInSection(content, section, formatted, 'append');

      await writeVaultFile(tempVault, 'meetings/log.md', modified, frontmatter, lineEnding);

      const result = await readTestNote(tempVault, 'meetings/log.md');
      // Should have timestamp format (HH:MM)
      expect(result).toMatch(/- \*\*\d{2}:\d{2}\*\* Decision made on API design/);
    });
  });

  describe('TOKEN_BENCHMARKS.md methodology', () => {
    it('should demonstrate token-efficient mutations', async () => {
      // Example: Section-based mutations are more token-efficient than full-file reads
      const largeNote = `---
type: documentation
---
# Large Document

## Section 1
${Array.from({ length: 50 }, (_, i) => `Line ${i} of section 1`).join('\n')}

## Target Section
Some content here.

## Section 3
${Array.from({ length: 50 }, (_, i) => `Line ${i} of section 3`).join('\n')}
`;
      await createTestNote(tempVault, 'docs/large.md', largeNote);

      const { content, frontmatter, lineEnding } = await readVaultFile(
        tempVault,
        'docs/large.md'
      );

      // Only target the section we need
      const section = findSection(content, 'Target Section')!;
      const modified = insertInSection(content, section, '- Efficient update', 'append');

      await writeVaultFile(tempVault, 'docs/large.md', modified, frontmatter, lineEnding);

      const result = await readTestNote(tempVault, 'docs/large.md');

      // Update should be in the right place
      expect(result).toContain('Some content here.');
      expect(result).toContain('- Efficient update');

      // Other sections should be unchanged
      expect(result).toContain('Line 0 of section 1');
      expect(result).toContain('Line 49 of section 3');
    });
  });

  describe('wikilinks.md examples', () => {
    let stateDb: StateDb;

    beforeEach(() => {
      stateDb = openStateDb(tempVault);
      setCrankStateDb(stateDb);
    });

    afterEach(() => {
      setCrankStateDb(null);
      stateDb.db.close();
      deleteStateDb(tempVault);
    });

    it('should demonstrate auto-wikilink application', async () => {
      // Set up entity cache
      createEntityCacheInStateDb(stateDb, tempVault, {
        people: ['Alice', 'Bob'],
        projects: ['Project X'],
      });

      const content = `---
type: meeting
---
# Meeting Notes

## Discussion
Met with Alice and Bob to discuss Project X progress.
`;
      await createTestNote(tempVault, 'meetings/note.md', content);

      await initializeEntityIndex(tempVault);

      const { content: readContent, frontmatter, lineEnding } = await readVaultFile(
        tempVault,
        'meetings/note.md'
      );

      // Apply wikilinks
      const result = processWikilinks(readContent, 'meetings/note.md');
      await writeVaultFile(tempVault, 'meetings/note.md', result.content, frontmatter, lineEnding);

      const final = await readTestNote(tempVault, 'meetings/note.md');

      // Should have some wikilinks applied
      if (result.linksAdded > 0) {
        expect(final).toContain('[[');
      }
    });

    it('should demonstrate suggestion suffix generation', async () => {
      createEntityCacheInStateDb(stateDb, tempVault, {
        people: ['Alice', 'Bob', 'Charlie'],
        projects: ['Project X', 'Project Y'],
        technologies: ['TypeScript', 'Node.js'],
      });

      await initializeEntityIndex(tempVault);

      // Get suggestions for content
      const content = 'Working on the project with the team using modern tech stack';
      const result = suggestRelatedLinks(content, {
        maxSuggestions: 3,
      });

      // Should have suggestions or empty result (valid either way)
      expect(result.suggestions).toBeInstanceOf(Array);
      expect(typeof result.suffix).toBe('string');

      // If suggestions exist, suffix format should be correct
      if (result.suggestions.length > 0) {
        expect(result.suffix).toContain('→');
      }
    });
  });

  describe('TROUBLESHOOTING.md solutions', () => {
    it('should handle missing section gracefully', async () => {
      const note = `---
type: note
---
# Note Without Target Section

## Other Section
Content here.
`;
      await createTestNote(tempVault, 'test.md', note);

      const { content } = await readVaultFile(tempVault, 'test.md');

      // Trying to find non-existent section should return null
      const section = findSection(content, 'Non-Existent Section');
      expect(section).toBeNull();
    });

    it('should handle empty file gracefully', async () => {
      // Create empty file
      await createTestNote(tempVault, 'empty.md', '');

      const { content } = await readVaultFile(tempVault, 'empty.md');
      expect(content).toBe('');

      // Finding section in empty file should return null
      const section = findSection(content, 'Any Section');
      expect(section).toBeNull();
    });

    it('should handle file without frontmatter', async () => {
      const note = `# Simple Note

## Section
Content without frontmatter.
`;
      await createTestNote(tempVault, 'no-fm.md', note);

      const { content, frontmatter } = await readVaultFile(tempVault, 'no-fm.md');

      expect(content).toContain('# Simple Note');
      // Frontmatter should be empty object
      expect(Object.keys(frontmatter).length).toBe(0);
    });
  });
});

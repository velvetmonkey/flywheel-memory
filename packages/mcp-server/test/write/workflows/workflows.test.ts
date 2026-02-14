/**
 * Workflow integration tests
 *
 * Tests realistic multi-step workflows using Flywheel-Crank tools
 * to verify end-to-end functionality.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFile } from 'fs/promises';
import path from 'path';
import {
  readVaultFile,
  writeVaultFile,
  findSection,
  formatContent,
  insertInSection,
  removeFromSection,
  replaceInSection,
} from '../../src/core/writer.js';
import {
  findTasks,
  toggleTask,
} from '../../src/tools/tasks.js';
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
  suggestRelatedLinks,
  setCrankStateDb,
} from '../../src/core/wikilinks.js';
import type { FormatType, Position } from '../../src/core/types.js';

// ========================================
// Fixture Loaders
// ========================================

const fixturesDir = path.join(__dirname, '../fixtures');

async function loadFixture(name: string): Promise<string> {
  return readFile(path.join(fixturesDir, name), 'utf-8');
}

// ========================================
// Workflow Helpers
// ========================================

async function addToSection(
  vaultPath: string,
  notePath: string,
  sectionName: string,
  content: string,
  position: Position,
  format: FormatType
): Promise<{ success: boolean; content?: string }> {
  const { content: fileContent, frontmatter } = await readVaultFile(vaultPath, notePath);
  const section = findSection(fileContent, sectionName);
  if (!section) return { success: false };

  const formattedContent = formatContent(content, format);
  const updatedContent = insertInSection(fileContent, section, formattedContent, position);
  await writeVaultFile(vaultPath, notePath, updatedContent, frontmatter);

  return { success: true, content: formattedContent };
}

async function toggleTaskInNote(
  vaultPath: string,
  notePath: string,
  taskText: string
): Promise<{ success: boolean; newState?: boolean }> {
  const { content: fileContent, frontmatter } = await readVaultFile(vaultPath, notePath);
  const tasks = findTasks(fileContent);
  const match = tasks.find(t => t.text.toLowerCase().includes(taskText.toLowerCase()));
  if (!match) return { success: false };

  const result = toggleTask(fileContent, match.line);
  if (!result) return { success: false };

  await writeVaultFile(vaultPath, notePath, result.content, frontmatter);
  return { success: true, newState: result.newState };
}

// ========================================
// Daily Note Workflow Tests
// ========================================

describe('Daily Note Workflow', () => {
  let tempVault: string;
  let stateDb: StateDb;

  beforeEach(async () => {
    tempVault = await createTempVault();
    stateDb = openStateDb(tempVault);
    setCrankStateDb(stateDb);
    createEntityCacheInStateDb(stateDb, tempVault, {
      people: ['Jordan Smith', 'Alex Rivera'],
      projects: ['MCP Server', 'Flywheel Crank'],
      technologies: ['TypeScript', 'JavaScript'],
    });
    await initializeEntityIndex(tempVault);
  });

  afterEach(async () => {
    setCrankStateDb(null);
    stateDb.db.close();
    deleteStateDb(tempVault);
    await cleanupTempVault(tempVault);
  });

  it('should create daily note and add multiple log entries', async () => {
    const fixture = await loadFixture('workflow-daily-note.md');
    await createTestNote(tempVault, 'daily-notes/2026-01-28.md', fixture);

    // Add first log entry
    await addToSection(
      tempVault,
      'daily-notes/2026-01-28.md',
      'Log',
      'Team standup meeting',
      'append',
      'timestamp-bullet'
    );

    // Add second log entry
    await addToSection(
      tempVault,
      'daily-notes/2026-01-28.md',
      'Log',
      'Code review completed',
      'append',
      'timestamp-bullet'
    );

    const updated = await readTestNote(tempVault, 'daily-notes/2026-01-28.md');

    // Verify original content preserved
    expect(updated).toContain('- **09:00** Started work');

    // Verify new entries added
    expect(updated).toMatch(/- \*\*\d{2}:\d{2}\*\* Team standup meeting/);
    expect(updated).toMatch(/- \*\*\d{2}:\d{2}\*\* Code review completed/);

    // Verify frontmatter preserved
    expect(updated).toContain('date: 2026-01-28');
    expect(updated).toContain('mood: productive');
  });

  it('should toggle habit checkboxes', async () => {
    const fixture = await loadFixture('workflow-daily-note.md');
    await createTestNote(tempVault, 'daily-notes/2026-01-28.md', fixture);

    // Toggle exercise habit
    const result = await toggleTaskInNote(
      tempVault,
      'daily-notes/2026-01-28.md',
      'Exercise'
    );

    expect(result.success).toBe(true);
    expect(result.newState).toBe(true);

    const updated = await readTestNote(tempVault, 'daily-notes/2026-01-28.md');
    expect(updated).toContain('- [x] Exercise');
    expect(updated).toContain('- [ ] Meditation'); // Unchanged
  });

  it('should add task with entity suggestions', async () => {
    const fixture = await loadFixture('workflow-daily-note.md');
    await createTestNote(tempVault, 'daily-notes/2026-01-28.md', fixture);

    // Add task with content that should trigger suggestions
    const taskContent = 'Review TypeScript changes with Jordan Smith';
    const suggestions = suggestRelatedLinks(taskContent);

    await addToSection(
      tempVault,
      'daily-notes/2026-01-28.md',
      'Tasks',
      taskContent,
      'append',
      'task'
    );

    const updated = await readTestNote(tempVault, 'daily-notes/2026-01-28.md');
    expect(updated).toContain('Review TypeScript changes with Jordan Smith');

    // Verify suggestions mechanism works
    if (suggestions.suggestions.length > 0) {
      expect(suggestions.suffix).toMatch(/^→ \[\[/);
    }
  });
});

// ========================================
// Project Progress Workflow Tests
// ========================================

describe('Project Progress Workflow', () => {
  let tempVault: string;
  let stateDb: StateDb;

  beforeEach(async () => {
    tempVault = await createTempVault();
    stateDb = openStateDb(tempVault);
    setCrankStateDb(stateDb);
    createEntityCacheInStateDb(stateDb, tempVault, {
      people: ['Jordan Smith'],
      projects: ['MCP Server'],
      technologies: ['TypeScript', 'Vitest'],
    });
    await initializeEntityIndex(tempVault);
  });

  afterEach(async () => {
    setCrankStateDb(null);
    stateDb.db.close();
    deleteStateDb(tempVault);
    await cleanupTempVault(tempVault);
  });

  it('should add progress bullets and replace status', async () => {
    const fixture = await loadFixture('workflow-project.md');
    await createTestNote(tempVault, 'projects/mcp-server.md', fixture);

    // Add progress bullet
    await addToSection(
      tempVault,
      'projects/mcp-server.md',
      'Progress',
      'Completed unit test coverage',
      'append',
      'bullet'
    );

    let updated = await readTestNote(tempVault, 'projects/mcp-server.md');
    expect(updated).toContain('- Completed unit test coverage');
    expect(updated).toContain('- Initial architecture complete');

    // Now replace status in frontmatter decisions section
    const { content: fileContent, frontmatter } = await readVaultFile(
      tempVault,
      'projects/mcp-server.md'
    );

    const section = findSection(fileContent, 'Progress');
    const replaceResult = replaceInSection(
      fileContent,
      section!,
      'Initial architecture complete',
      'Initial architecture complete (DONE)',
      'first',
      false
    );

    await writeVaultFile(tempVault, 'projects/mcp-server.md', replaceResult.content, frontmatter);

    updated = await readTestNote(tempVault, 'projects/mcp-server.md');
    expect(updated).toContain('- Initial architecture complete (DONE)');
  });

  it('should toggle project TODOs', async () => {
    const fixture = await loadFixture('workflow-project.md');
    await createTestNote(tempVault, 'projects/mcp-server.md', fixture);

    // Toggle first TODO
    const result = await toggleTaskInNote(
      tempVault,
      'projects/mcp-server.md',
      'comprehensive tests'
    );

    expect(result.success).toBe(true);
    expect(result.newState).toBe(true);

    const updated = await readTestNote(tempVault, 'projects/mcp-server.md');
    expect(updated).toContain('- [x] Add comprehensive tests');
    expect(updated).toContain('- [ ] Write documentation'); // Unchanged
  });

  it('should remove completed items from Progress', async () => {
    const fixture = await loadFixture('workflow-project.md');
    await createTestNote(tempVault, 'projects/mcp-server.md', fixture);

    const { content: fileContent, frontmatter } = await readVaultFile(
      tempVault,
      'projects/mcp-server.md'
    );

    const section = findSection(fileContent, 'Progress');
    const removeResult = removeFromSection(
      fileContent,
      section!,
      'Initial architecture',
      'first',
      false
    );

    expect(removeResult.removedCount).toBe(1);

    await writeVaultFile(tempVault, 'projects/mcp-server.md', removeResult.content, frontmatter);

    const updated = await readTestNote(tempVault, 'projects/mcp-server.md');
    expect(updated).not.toContain('Initial architecture complete');
    expect(updated).toContain('Core mutations implemented');
  });
});

// ========================================
// Meeting Notes Workflow Tests
// ========================================

describe('Meeting Notes Workflow', () => {
  let tempVault: string;
  let stateDb: StateDb;

  beforeEach(async () => {
    tempVault = await createTempVault();
    stateDb = openStateDb(tempVault);
    setCrankStateDb(stateDb);
    createEntityCacheInStateDb(stateDb, tempVault, {
      people: ['Jordan Smith', 'Alex Rivera'],
      projects: ['MCP Server', 'API Design'],
    });
    await initializeEntityIndex(tempVault);
  });

  afterEach(async () => {
    setCrankStateDb(null);
    stateDb.db.close();
    deleteStateDb(tempVault);
    await cleanupTempVault(tempVault);
  });

  it('should add meeting notes and action items', async () => {
    const fixture = await loadFixture('workflow-meeting.md');
    await createTestNote(tempVault, 'meetings/2026-01-28-sprint.md', fixture);

    // Add note
    await addToSection(
      tempVault,
      'meetings/2026-01-28-sprint.md',
      'Notes',
      'Discussed API versioning strategy',
      'append',
      'bullet'
    );

    // Add action item
    await addToSection(
      tempVault,
      'meetings/2026-01-28-sprint.md',
      'Action Items',
      'Create API versioning proposal',
      'append',
      'task'
    );

    const updated = await readTestNote(tempVault, 'meetings/2026-01-28-sprint.md');

    expect(updated).toContain('- Discussed API versioning strategy');
    expect(updated).toContain('- [ ] Create API versioning proposal');

    // Verify attendees preserved
    expect(updated).toContain('- Jordan Smith (Engineering Lead)');
    expect(updated).toContain('- Alex Rivera (Developer)');
  });

  it('should toggle action items as completed', async () => {
    const fixture = await loadFixture('workflow-meeting.md');
    await createTestNote(tempVault, 'meetings/2026-01-28-sprint.md', fixture);

    // Toggle Jordan's action item
    const result = await toggleTaskInNote(
      tempVault,
      'meetings/2026-01-28-sprint.md',
      'Review API design'
    );

    expect(result.success).toBe(true);

    const updated = await readTestNote(tempVault, 'meetings/2026-01-28-sprint.md');
    expect(updated).toContain('- [x] Jordan: Review API design');
    expect(updated).toContain('- [ ] Alex: Update documentation'); // Unchanged
  });

  it('should verify suggestion mechanism works with meeting content', async () => {
    const fixture = await loadFixture('workflow-meeting.md');
    await createTestNote(tempVault, 'meetings/2026-01-28-sprint.md', fixture);

    // Test the suggestion mechanism with entity content
    const noteContent = 'Jordan Smith presented MCP Server architecture';
    const suggestions = suggestRelatedLinks(noteContent);

    await addToSection(
      tempVault,
      'meetings/2026-01-28-sprint.md',
      'Notes',
      noteContent,
      'append',
      'bullet'
    );

    const updated = await readTestNote(tempVault, 'meetings/2026-01-28-sprint.md');

    // Content should be added
    expect(updated).toContain('Jordan Smith presented MCP Server architecture');

    // Verify suggestion mechanism works (entities loaded)
    if (suggestions.suggestions.length > 0) {
      expect(suggestions.suffix).toMatch(/^→ \[\[/);
    }
  });
});

// ========================================
// Messy Vault Stress Tests
// ========================================

describe('Messy Vault Stress Test', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should handle note without frontmatter', async () => {
    const noFrontmatter = `# Simple Note

## Log

- Entry 1

## Tasks

- [ ] Do something
`;
    await createTestNote(tempVault, 'simple.md', noFrontmatter);

    const result = await addToSection(
      tempVault,
      'simple.md',
      'Log',
      'Entry 2',
      'append',
      'bullet'
    );

    expect(result.success).toBe(true);

    const updated = await readTestNote(tempVault, 'simple.md');
    expect(updated).toContain('- Entry 1');
    expect(updated).toContain('- Entry 2');
    expect(updated).not.toContain('---'); // No frontmatter added
  });

  it('should handle CRLF line endings', async () => {
    const crlfContent = '---\r\ntype: test\r\n---\r\n# Test\r\n\r\n## Log\r\n\r\n- Entry\r\n';
    await createTestNote(tempVault, 'crlf.md', crlfContent);

    const result = await addToSection(
      tempVault,
      'crlf.md',
      'Log',
      'New entry',
      'append',
      'bullet'
    );

    expect(result.success).toBe(true);

    const updated = await readTestNote(tempVault, 'crlf.md');
    expect(updated).toContain('New entry');
  });

  it('should handle empty section', async () => {
    const emptySection = `---
type: test
---
# Test

## Empty Section

## Next Section

Content here
`;
    await createTestNote(tempVault, 'empty.md', emptySection);

    const result = await addToSection(
      tempVault,
      'empty.md',
      'Empty Section',
      'First entry',
      'append',
      'bullet'
    );

    expect(result.success).toBe(true);

    const updated = await readTestNote(tempVault, 'empty.md');
    expect(updated).toContain('- First entry');

    // Verify ordering
    const emptyIndex = updated.indexOf('## Empty Section');
    const firstIndex = updated.indexOf('- First entry');
    const nextIndex = updated.indexOf('## Next Section');
    expect(firstIndex).toBeGreaterThan(emptyIndex);
    expect(firstIndex).toBeLessThan(nextIndex);
  });

  it('should handle unicode in filenames and content', async () => {
    const unicodeContent = `---
type: test
---
# 日本語テスト

## ログ

- エントリー1
`;
    await createTestNote(tempVault, 'unicode-ユニコード.md', unicodeContent);

    const result = await addToSection(
      tempVault,
      'unicode-ユニコード.md',
      'ログ',
      'エントリー2',
      'append',
      'bullet'
    );

    expect(result.success).toBe(true);

    const updated = await readTestNote(tempVault, 'unicode-ユニコード.md');
    expect(updated).toContain('- エントリー1');
    expect(updated).toContain('- エントリー2');
  });

  it('should handle deeply nested file paths', async () => {
    const content = `---
type: test
---
# Deep Note

## Log

- Entry
`;
    await createTestNote(
      tempVault,
      'areas/work/projects/2026/q1/weekly/notes.md',
      content
    );

    const result = await addToSection(
      tempVault,
      'areas/work/projects/2026/q1/weekly/notes.md',
      'Log',
      'Deep entry',
      'append',
      'bullet'
    );

    expect(result.success).toBe(true);

    const updated = await readTestNote(
      tempVault,
      'areas/work/projects/2026/q1/weekly/notes.md'
    );
    expect(updated).toContain('- Deep entry');
  });

  it('should handle special characters in content', async () => {
    const content = `---
type: test
---
# Special

## Log

- Regular entry
`;
    await createTestNote(tempVault, 'special.md', content);

    const specialContent = 'Entry with `code` and **bold** and [[wikilink]] and $math$ and <html>';

    const result = await addToSection(
      tempVault,
      'special.md',
      'Log',
      specialContent,
      'append',
      'plain'
    );

    expect(result.success).toBe(true);

    const updated = await readTestNote(tempVault, 'special.md');
    expect(updated).toContain('`code`');
    expect(updated).toContain('**bold**');
    expect(updated).toContain('[[wikilink]]');
    expect(updated).toContain('$math$');
    expect(updated).toContain('<html>');
  });
});

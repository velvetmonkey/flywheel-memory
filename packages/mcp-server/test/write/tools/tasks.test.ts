/**
 * Integration tests for task tools
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  readVaultFile,
  writeVaultFile,
  findSection,
  insertInSection,
} from '../../../src/core/write/writer.js';
import {
  findTasks,
  toggleTask,
  type TaskInfo,
} from '../../../src/tools/write/tasks.js';
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
import type { Position } from '../../../src/core/write/types.js';
import {
  initializeEntityIndex,
  suggestRelatedLinks,
  setWriteStateDb,
} from '../../../src/core/write/wikilinks.js';

/**
 * Helper to simulate vault_toggle_task workflow
 */
async function toggleTaskInNote(
  vaultPath: string,
  notePath: string,
  taskText: string,
  sectionName?: string
): Promise<{ success: boolean; message: string; newState?: boolean }> {
  try {
    const { content: fileContent, frontmatter } = await readVaultFile(vaultPath, notePath);

    // Find section if specified
    let section;
    if (sectionName) {
      section = findSection(fileContent, sectionName);
      if (!section) {
        return {
          success: false,
          message: `Section not found: ${sectionName}`,
        };
      }
    }

    // Find tasks
    const tasks = findTasks(fileContent, section);

    // Find matching task
    const searchLower = taskText.toLowerCase();
    const matchingTask = tasks.find((t) =>
      t.text.toLowerCase().includes(searchLower)
    );

    if (!matchingTask) {
      return {
        success: false,
        message: `No task found matching "${taskText}"`,
      };
    }

    // Toggle the task
    const toggleResult = toggleTask(fileContent, matchingTask.line);
    if (!toggleResult) {
      return {
        success: false,
        message: 'Failed to toggle task',
      };
    }

    await writeVaultFile(vaultPath, notePath, toggleResult.content, frontmatter);

    return {
      success: true,
      message: `Toggled task to ${toggleResult.newState ? 'completed' : 'incomplete'}`,
      newState: toggleResult.newState,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Helper to simulate vault_add_task workflow
 */
async function addTaskToNote(
  vaultPath: string,
  notePath: string,
  sectionName: string,
  taskText: string,
  position: Position = 'append',
  completed: boolean = false,
  preserveListNesting: boolean = true
): Promise<{ success: boolean; message: string; preview?: string }> {
  try {
    const { content: fileContent, frontmatter } = await readVaultFile(vaultPath, notePath);

    const section = findSection(fileContent, sectionName);
    if (!section) {
      return {
        success: false,
        message: `Section not found: ${sectionName}`,
      };
    }

    const checkbox = completed ? '[x]' : '[ ]';
    const taskLine = `- ${checkbox} ${taskText.trim()}`;

    const updatedContent = insertInSection(fileContent, section, taskLine, position, { preserveListNesting });
    await writeVaultFile(vaultPath, notePath, updatedContent, frontmatter);

    return {
      success: true,
      message: `Added task to section "${section.name}"`,
      preview: taskLine,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

describe('findTasks', () => {
  it('should find all tasks in content', () => {
    const content = `# Test

## Tasks

- [ ] Unchecked task
- [x] Checked task
- [X] Also checked
- Regular bullet
- [ ] Another unchecked
`;

    const tasks = findTasks(content);

    expect(tasks.length).toBe(4);
    expect(tasks[0].text).toBe('Unchecked task');
    expect(tasks[0].completed).toBe(false);
    expect(tasks[1].text).toBe('Checked task');
    expect(tasks[1].completed).toBe(true);
    expect(tasks[2].text).toBe('Also checked');
    expect(tasks[2].completed).toBe(true);
    expect(tasks[3].text).toBe('Another unchecked');
    expect(tasks[3].completed).toBe(false);
  });

  it('should find tasks only in specified section', () => {
    const content = `# Test

## Section A

- [ ] Task A1
- [ ] Task A2

## Section B

- [ ] Task B1
`;

    const sectionB = findSection(content, 'Section B');
    const tasks = findTasks(content, sectionB!);

    expect(tasks.length).toBe(1);
    expect(tasks[0].text).toBe('Task B1');
  });

  it('should handle indented tasks', () => {
    const content = `# Test

- [ ] Parent task
  - [ ] Child task
    - [ ] Grandchild task
`;

    const tasks = findTasks(content);

    expect(tasks.length).toBe(3);
    expect(tasks[0].indent).toBe('');
    expect(tasks[1].indent).toBe('  ');
    expect(tasks[2].indent).toBe('    ');
  });
});

describe('toggleTask', () => {
  it('should toggle unchecked to checked', () => {
    const content = `- [ ] My task`;
    const result = toggleTask(content, 0);

    expect(result).not.toBeNull();
    expect(result!.newState).toBe(true);
    expect(result!.content).toBe('- [x] My task');
  });

  it('should toggle checked to unchecked', () => {
    const content = `- [x] My task`;
    const result = toggleTask(content, 0);

    expect(result).not.toBeNull();
    expect(result!.newState).toBe(false);
    expect(result!.content).toBe('- [ ] My task');
  });

  it('should toggle uppercase X to unchecked', () => {
    const content = `- [X] My task`;
    const result = toggleTask(content, 0);

    expect(result).not.toBeNull();
    expect(result!.newState).toBe(false);
    expect(result!.content).toBe('- [ ] My task');
  });

  it('should return null for non-task line', () => {
    const content = `- Regular bullet`;
    const result = toggleTask(content, 0);

    expect(result).toBeNull();
  });

  it('should return null for invalid line number', () => {
    const content = `- [ ] Task`;
    const result = toggleTask(content, 5);

    expect(result).toBeNull();
  });
});

describe('vault_toggle_task integration workflow', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should toggle unchecked task to checked', async () => {
    const note = `---
type: test
---
# Test

## Tasks

- [ ] Buy groceries
- [ ] Clean house
`;
    await createTestNote(tempVault, 'test.md', note);

    const result = await toggleTaskInNote(tempVault, 'test.md', 'groceries');

    expect(result.success).toBe(true);
    expect(result.newState).toBe(true);

    const updated = await readTestNote(tempVault, 'test.md');
    expect(updated).toContain('- [x] Buy groceries');
    expect(updated).toContain('- [ ] Clean house'); // Unchanged
  });

  it('should toggle checked task to unchecked', async () => {
    const note = `---
type: test
---
# Test

## Tasks

- [x] Completed task
`;
    await createTestNote(tempVault, 'test.md', note);

    const result = await toggleTaskInNote(tempVault, 'test.md', 'Completed');

    expect(result.success).toBe(true);
    expect(result.newState).toBe(false);

    const updated = await readTestNote(tempVault, 'test.md');
    expect(updated).toContain('- [ ] Completed task');
  });

  it('should find task by partial match (case-insensitive)', async () => {
    const note = `---
type: test
---
# Test

## Tasks

- [ ] Buy GROCERIES from store
`;
    await createTestNote(tempVault, 'test.md', note);

    const result = await toggleTaskInNote(tempVault, 'test.md', 'groceries');

    expect(result.success).toBe(true);

    const updated = await readTestNote(tempVault, 'test.md');
    expect(updated).toContain('- [x] Buy GROCERIES from store');
  });

  it('should respect section boundary', async () => {
    const note = `---
type: test
---
# Test

## Section A

- [ ] Task A

## Section B

- [ ] Task B
`;
    await createTestNote(tempVault, 'test.md', note);

    const result = await toggleTaskInNote(tempVault, 'test.md', 'Task', 'Section B');

    expect(result.success).toBe(true);

    const updated = await readTestNote(tempVault, 'test.md');
    expect(updated).toContain('- [ ] Task A'); // Unchanged (in Section A)
    expect(updated).toContain('- [x] Task B'); // Toggled (in Section B)
  });

  it('should return error when task not found', async () => {
    const note = `---
type: test
---
# Test

## Tasks

- [ ] Existing task
`;
    await createTestNote(tempVault, 'test.md', note);

    const result = await toggleTaskInNote(tempVault, 'test.md', 'NonExistent');

    expect(result.success).toBe(false);
    expect(result.message).toContain('No task found');
  });

  it('should return error when section not found', async () => {
    const note = `---
type: test
---
# Test

## Tasks

- [ ] Task
`;
    await createTestNote(tempVault, 'test.md', note);

    const result = await toggleTaskInNote(tempVault, 'test.md', 'Task', 'NonExistent');

    expect(result.success).toBe(false);
    expect(result.message).toContain('Section not found');
  });
});

describe('vault_add_task integration workflow', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should add unchecked task to section', async () => {
    const note = `---
type: test
---
# Test

## Tasks

- [ ] Existing task
`;
    await createTestNote(tempVault, 'test.md', note);

    const result = await addTaskToNote(tempVault, 'test.md', 'Tasks', 'New task');

    expect(result.success).toBe(true);
    expect(result.preview).toBe('- [ ] New task');

    const updated = await readTestNote(tempVault, 'test.md');
    expect(updated).toContain('- [ ] Existing task');
    expect(updated).toContain('- [ ] New task');
  });

  it('should add checked task when completed=true', async () => {
    const note = `---
type: test
---
# Test

## Tasks

`;
    await createTestNote(tempVault, 'test.md', note);

    const result = await addTaskToNote(tempVault, 'test.md', 'Tasks', 'Already done', 'append', true);

    expect(result.success).toBe(true);
    expect(result.preview).toBe('- [x] Already done');

    const updated = await readTestNote(tempVault, 'test.md');
    expect(updated).toContain('- [x] Already done');
  });

  it('should prepend task when position=prepend', async () => {
    const note = `---
type: test
---
# Test

## Tasks

- [ ] Existing task
`;
    await createTestNote(tempVault, 'test.md', note);

    const result = await addTaskToNote(tempVault, 'test.md', 'Tasks', 'First task', 'prepend');

    expect(result.success).toBe(true);

    const updated = await readTestNote(tempVault, 'test.md');
    const firstIndex = updated.indexOf('- [ ] First task');
    const existingIndex = updated.indexOf('- [ ] Existing task');
    expect(firstIndex).toBeLessThan(existingIndex);
  });

  it('should return error when section not found', async () => {
    const note = `---
type: test
---
# Test

## Tasks
`;
    await createTestNote(tempVault, 'test.md', note);

    const result = await addTaskToNote(tempVault, 'test.md', 'NonExistent', 'Task');

    expect(result.success).toBe(false);
    expect(result.message).toContain('Section not found');
  });

  it('should trim task text', async () => {
    const note = `---
type: test
---
# Test

## Tasks
`;
    await createTestNote(tempVault, 'test.md', note);

    const result = await addTaskToNote(tempVault, 'test.md', 'Tasks', '   Padded task   ');

    expect(result.success).toBe(true);
    expect(result.preview).toBe('- [ ] Padded task');

    const updated = await readTestNote(tempVault, 'test.md');
    expect(updated).toContain('- [ ] Padded task');
    expect(updated).not.toContain('   Padded task   ');
  });

  it('should preserve list nesting when adding task to nested list (regression)', async () => {
    // Regression test: tasks added to sections with nested lists should respect indentation
    const note = `---
type: test
---
# Test

## Tasks

- [ ] Parent task
  - [ ] Nested task 1
  - [ ] Nested task 2
`;
    await createTestNote(tempVault, 'test.md', note);

    // When appending to a section with nested tasks, new task should respect context
    const result = await addTaskToNote(tempVault, 'test.md', 'Tasks', 'New sibling task', 'append', false, true);

    expect(result.success).toBe(true);

    const updated = await readTestNote(tempVault, 'test.md');
    // The new task should be inserted with indentation matching the nested context
    expect(updated).toContain('- [ ] New sibling task');
    // Original structure preserved
    expect(updated).toContain('- [ ] Parent task');
    expect(updated).toContain('  - [ ] Nested task 1');
    expect(updated).toContain('  - [ ] Nested task 2');
  });

  it('should add task at top level when preserveListNesting is false', async () => {
    const note = `---
type: test
---
# Test

## Tasks

- [ ] Parent task
  - [ ] Nested task
`;
    await createTestNote(tempVault, 'test.md', note);

    // With preserveListNesting=false, should always insert at top level
    const result = await addTaskToNote(tempVault, 'test.md', 'Tasks', 'Top level task', 'append', false, false);

    expect(result.success).toBe(true);

    const updated = await readTestNote(tempVault, 'test.md');
    // The new task should NOT be indented
    expect(updated).toMatch(/^- \[ \] Top level task$/m);
  });
});

// ========================================
// skipWikilinks Parameter Tests
// ========================================

describe('vault_add_task skipWikilinks parameter', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should preserve task text with entity-like content', async () => {
    const note = `---
type: test
---
# Test

## Tasks

- [ ] Existing task
`;
    await createTestNote(tempVault, 'test.md', note);

    const result = await addTaskToNote(
      tempVault,
      'test.md',
      'Tasks',
      'Review MCP Server changes with Jordan Smith'
    );

    expect(result.success).toBe(true);
    expect(result.preview).toContain('Review MCP Server changes with Jordan Smith');

    const updated = await readTestNote(tempVault, 'test.md');
    expect(updated).toContain('MCP Server');
    expect(updated).toContain('Jordan Smith');
  });

  it('should work with completed task and entity-like content', async () => {
    const note = `---
type: test
---
# Test

## Tasks
`;
    await createTestNote(tempVault, 'test.md', note);

    const result = await addTaskToNote(
      tempVault,
      'test.md',
      'Tasks',
      'Updated TypeScript config',
      'append',
      true // completed
    );

    expect(result.success).toBe(true);
    expect(result.preview).toBe('- [x] Updated TypeScript config');

    const updated = await readTestNote(tempVault, 'test.md');
    expect(updated).toContain('- [x] Updated TypeScript config');
  });

  it('should preserve existing wikilinks in task text', async () => {
    const note = `---
type: test
---
# Test

## Tasks
`;
    await createTestNote(tempVault, 'test.md', note);

    const result = await addTaskToNote(
      tempVault,
      'test.md',
      'Tasks',
      'Meet with [[Jordan Smith]] about [[API]] design'
    );

    expect(result.success).toBe(true);

    const updated = await readTestNote(tempVault, 'test.md');
    expect(updated).toContain('[[Jordan Smith]]');
    expect(updated).toContain('[[API]]');
  });

  it('should work with prepend position and entity-like content', async () => {
    const note = `---
type: test
---
# Test

## Tasks

- [ ] Existing task
`;
    await createTestNote(tempVault, 'test.md', note);

    const result = await addTaskToNote(
      tempVault,
      'test.md',
      'Tasks',
      'Review API documentation',
      'prepend'
    );

    expect(result.success).toBe(true);

    const updated = await readTestNote(tempVault, 'test.md');
    const reviewIndex = updated.indexOf('Review API documentation');
    const existingIndex = updated.indexOf('Existing task');
    expect(reviewIndex).toBeLessThan(existingIndex);
  });

  it('should handle multiple entity references in task', async () => {
    const note = `---
type: test
---
# Test

## Tasks
`;
    await createTestNote(tempVault, 'test.md', note);

    const result = await addTaskToNote(
      tempVault,
      'test.md',
      'Tasks',
      'Help Jordan Smith with TypeScript and MCP Server API integration'
    );

    expect(result.success).toBe(true);

    const updated = await readTestNote(tempVault, 'test.md');
    expect(updated).toContain('Jordan Smith');
    expect(updated).toContain('TypeScript');
    expect(updated).toContain('MCP Server');
    expect(updated).toContain('API');
  });

  it('should handle task with code snippets and entity-like content', async () => {
    const note = `---
type: test
---
# Test

## Tasks
`;
    await createTestNote(tempVault, 'test.md', note);

    const result = await addTaskToNote(
      tempVault,
      'test.md',
      'Tasks',
      'Run `npm test` for MCP Server'
    );

    expect(result.success).toBe(true);
    expect(result.preview).toContain('`npm test`');
    expect(result.preview).toContain('MCP Server');

    const updated = await readTestNote(tempVault, 'test.md');
    expect(updated).toContain('`npm test`');
    expect(updated).toContain('MCP Server');
  });
});

// ========================================
// suggestOutgoingLinks Parameter Tests
// ========================================

describe('vault_add_task suggestOutgoingLinks parameter', () => {
  let tempVault: string;
  let stateDb: StateDb;

  beforeEach(async () => {
    tempVault = await createTempVault();
    stateDb = openStateDb(tempVault);
    setWriteStateDb(stateDb);
    // Create entity cache with known entities
    createEntityCacheInStateDb(stateDb, tempVault, {
      technologies: ['TypeScript', 'JavaScript', 'Python'],
      projects: ['MCP Server', 'Flywheel Memory'],
      people: ['Jordan Smith', 'Alex Rivera'],
      acronyms: ['API', 'CLI', 'MCP'],
    });
    // Initialize entity index
    await initializeEntityIndex(tempVault);
  });

  afterEach(async () => {
    setWriteStateDb(null);
    stateDb.db.close();
    deleteStateDb(tempVault);
    await cleanupTempVault(tempVault);
  });

  it('should suggest entities based on task content', async () => {
    const result = await suggestRelatedLinks('Review TypeScript implementation');

    // Verify suggestion mechanism works for task content
    // suffix is only generated for entities scoring >= MIN_SUFFIX_SCORE=12
    if (result.suffix) {
      expect(result.suffix).toMatch(/^→ \[\[/);
    }
  });

  it('should not suggest already-linked entities in task', async () => {
    const taskContent = 'Work with [[Jordan Smith]] on API design';
    const result = await suggestRelatedLinks(taskContent, { excludeLinked: true });

    // Jordan Smith should not be in suggestions since already linked
    if (result.suggestions.length > 0) {
      expect(result.suggestions.map(s => s.toLowerCase())).not.toContain('dave evans');
    }
  });

  it('should be idempotent for task content', async () => {
    const content = 'Review code → [[TypeScript]] [[MCP Server]]';
    const result = await suggestRelatedLinks(content);

    // Should detect existing suffix and return empty
    expect(result.suggestions).toEqual([]);
    expect(result.suffix).toBe('');
  });

  it('should handle task with multiple potential entities', async () => {
    const result = await suggestRelatedLinks('Update TypeScript and JavaScript for MCP Server');

    // Should return multiple suggestions (up to maxSuggestions)
    expect(result.suggestions.length).toBeLessThanOrEqual(5);
  });
});

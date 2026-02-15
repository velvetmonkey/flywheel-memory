/**
 * Tests for rename_tag tool
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createTempVault,
  cleanupTempVault,
  createTestNote,
  readTestNote,
} from '../../helpers/testUtils.js';
import { renameTag } from '../../../src/core/write/tagRename.js';
import type { VaultIndex, VaultNote } from '../../../src/core/read/types.js';

// =============================================================================
// HELPERS
// =============================================================================

function buildIndex(notes: VaultNote[]): VaultIndex {
  const noteMap = new Map<string, VaultNote>();
  const tags = new Map<string, Set<string>>();

  for (const note of notes) {
    noteMap.set(note.path, note);
    for (const tag of note.tags) {
      if (!tags.has(tag)) tags.set(tag, new Set());
      tags.get(tag)!.add(note.path);
    }
  }

  return {
    notes: noteMap,
    backlinks: new Map(),
    entities: new Map(),
    tags,
    builtAt: new Date(),
  };
}

function makeNote(notePath: string, tagsList: string[]): VaultNote {
  return {
    path: notePath,
    title: notePath.replace(/\.md$/, '').split('/').pop() || notePath,
    aliases: [],
    frontmatter: { tags: tagsList },
    outlinks: [],
    tags: tagsList,
    modified: new Date(),
  };
}

// =============================================================================
// TESTS
// =============================================================================

describe('rename_tag', () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(vaultPath);
  });

  // --------------------------------------------------------
  // Frontmatter-only rename
  // --------------------------------------------------------
  it('should rename tag in frontmatter only', async () => {
    await createTestNote(vaultPath, 'note1.md', `---
tags:
  - project
  - active
---
# Note 1

Some content without inline tags.
`);

    const index = buildIndex([makeNote('note1.md', ['project', 'active'])]);
    const result = await renameTag(index, vaultPath, 'project', 'work', { dry_run: false });

    expect(result.affected_notes).toBe(1);
    expect(result.total_changes).toBe(1);
    expect(result.previews[0].frontmatter_changes).toHaveLength(1);
    expect(result.previews[0].frontmatter_changes[0].old).toBe('project');
    expect(result.previews[0].frontmatter_changes[0].new).toBe('work');

    // Verify file was actually changed
    const content = await readTestNote(vaultPath, 'note1.md');
    expect(content).toContain('- work');
    expect(content).not.toContain('- project');
  });

  // --------------------------------------------------------
  // Inline tags in content
  // --------------------------------------------------------
  it('should rename inline tags in content', async () => {
    await createTestNote(vaultPath, 'note2.md', `---
tags: []
---
# Note 2

Working on #project today. Also #project/active is relevant.
`);

    const index = buildIndex([makeNote('note2.md', ['project', 'project/active'])]);
    const result = await renameTag(index, vaultPath, 'project', 'work', { dry_run: false });

    expect(result.total_changes).toBeGreaterThanOrEqual(2);

    const content = await readTestNote(vaultPath, 'note2.md');
    expect(content).toContain('#work');
    expect(content).toContain('#work/active');
    expect(content).not.toContain('#project');
  });

  // --------------------------------------------------------
  // Hierarchical rename (children on)
  // --------------------------------------------------------
  it('should rename child tags when rename_children is true', async () => {
    await createTestNote(vaultPath, 'note3.md', `---
tags:
  - project
  - project/active
  - project/archive
---
# Note 3

Content with #project/active and #project/archive tags.
`);

    const index = buildIndex([makeNote('note3.md', ['project', 'project/active', 'project/archive'])]);
    const result = await renameTag(index, vaultPath, 'project', 'work', {
      rename_children: true,
      dry_run: false,
    });

    const content = await readTestNote(vaultPath, 'note3.md');
    expect(content).toContain('- work');
    expect(content).toContain('- work/active');
    expect(content).toContain('- work/archive');
    expect(content).not.toContain('- project');
  });

  // --------------------------------------------------------
  // Hierarchical rename (children off)
  // --------------------------------------------------------
  it('should NOT rename child tags when rename_children is false', async () => {
    await createTestNote(vaultPath, 'note4.md', `---
tags:
  - project
  - project/active
---
# Note 4

Content with #project and #project/active tags.
`);

    const index = buildIndex([makeNote('note4.md', ['project', 'project/active'])]);
    const result = await renameTag(index, vaultPath, 'project', 'work', {
      rename_children: false,
      dry_run: false,
    });

    const content = await readTestNote(vaultPath, 'note4.md');
    expect(content).toContain('- work');
    // project/active should NOT be renamed
    expect(content).toContain('- project/active');
  });

  // --------------------------------------------------------
  // Skip tags in code blocks
  // --------------------------------------------------------
  it('should skip tags in code blocks', async () => {
    await createTestNote(vaultPath, 'note5.md', `---
tags:
  - project
---
# Note 5

Here is #project in normal text.

\`\`\`bash
# project is a comment here, not a tag
echo #project
\`\`\`

And \`#project\` in inline code should be skipped.
`);

    const index = buildIndex([makeNote('note5.md', ['project'])]);
    const result = await renameTag(index, vaultPath, 'project', 'work', { dry_run: false });

    const content = await readTestNote(vaultPath, 'note5.md');
    // Frontmatter should be renamed
    expect(content).toContain('- work');
    // Normal text should be renamed
    expect(content).toContain('#work in normal text');
    // Code blocks should be preserved
    expect(content).toContain('# project is a comment here');
    expect(content).toContain('echo #project');
  });

  // --------------------------------------------------------
  // Conflict detection (merge/dedup)
  // --------------------------------------------------------
  it('should deduplicate when new tag already exists in frontmatter', async () => {
    await createTestNote(vaultPath, 'note6.md', `---
tags:
  - project
  - work
---
# Note 6

Some content.
`);

    const index = buildIndex([makeNote('note6.md', ['project', 'work'])]);
    const result = await renameTag(index, vaultPath, 'project', 'work', { dry_run: false });

    const content = await readTestNote(vaultPath, 'note6.md');
    // Should have only one 'work' tag, not duplicated
    const tagMatches = content.match(/- work/g);
    expect(tagMatches).toHaveLength(1);
  });

  // --------------------------------------------------------
  // Dry-run preview
  // --------------------------------------------------------
  it('should preview changes without modifying files in dry-run mode', async () => {
    await createTestNote(vaultPath, 'note7.md', `---
tags:
  - project
---
# Note 7

Content with #project tag.
`);

    const index = buildIndex([makeNote('note7.md', ['project'])]);
    const result = await renameTag(index, vaultPath, 'project', 'work', { dry_run: true });

    expect(result.dry_run).toBe(true);
    expect(result.affected_notes).toBe(1);
    expect(result.total_changes).toBeGreaterThanOrEqual(1);

    // File should NOT be modified
    const content = await readTestNote(vaultPath, 'note7.md');
    expect(content).toContain('- project');
    expect(content).not.toContain('- work');
  });

  // --------------------------------------------------------
  // Folder scoping
  // --------------------------------------------------------
  it('should only rename in specified folder', async () => {
    await createTestNote(vaultPath, 'projects/note-a.md', `---
tags:
  - status
---
# A
`);
    await createTestNote(vaultPath, 'daily/note-b.md', `---
tags:
  - status
---
# B
`);

    const index = buildIndex([
      makeNote('projects/note-a.md', ['status']),
      makeNote('daily/note-b.md', ['status']),
    ]);

    const result = await renameTag(index, vaultPath, 'status', 'state', {
      folder: 'projects',
      dry_run: false,
    });

    expect(result.affected_notes).toBe(1);
    expect(result.previews[0].path).toBe('projects/note-a.md');

    // Verify only the scoped file changed
    const contentA = await readTestNote(vaultPath, 'projects/note-a.md');
    expect(contentA).toContain('- state');

    const contentB = await readTestNote(vaultPath, 'daily/note-b.md');
    expect(contentB).toContain('- status');
  });

  // --------------------------------------------------------
  // Multiple notes affected
  // --------------------------------------------------------
  it('should rename across multiple notes', async () => {
    await createTestNote(vaultPath, 'note-x.md', `---
tags:
  - todo
---
# X

Tasks with #todo items.
`);
    await createTestNote(vaultPath, 'note-y.md', `---
tags:
  - todo
  - todo/urgent
---
# Y

More #todo/urgent work.
`);

    const index = buildIndex([
      makeNote('note-x.md', ['todo']),
      makeNote('note-y.md', ['todo', 'todo/urgent']),
    ]);

    const result = await renameTag(index, vaultPath, 'todo', 'task', { dry_run: false });

    expect(result.affected_notes).toBe(2);
    expect(result.total_changes).toBeGreaterThanOrEqual(4);

    const contentX = await readTestNote(vaultPath, 'note-x.md');
    expect(contentX).toContain('- task');
    expect(contentX).toContain('#task');

    const contentY = await readTestNote(vaultPath, 'note-y.md');
    expect(contentY).toContain('- task');
    expect(contentY).toContain('- task/urgent');
    expect(contentY).toContain('#task/urgent');
  });
});

/**
 * Trace test: undo
 *
 * Verifies that vault_undo_last_mutation correctly reverses the effects
 * of vault_create_note, vault_add_to_section, and vault_update_frontmatter.
 * Requires a git-initialized vault.
 *
 * Note: vault_undo_last_mutation performs a soft git reset (HEAD moves back,
 * but files remain on disk). After the soft reset, we use a hard reset to
 * restore the working tree so the on-disk state matches the reverted HEAD.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import simpleGit from 'simple-git';
import { createWriteTestServer, type WriteTestServerContext } from '../../helpers/createWriteTestServer.js';
import { connectTestClient, type TestClient } from '../../read/helpers/createTestServer.js';
import { createTestNote } from '../helpers/testUtils.js';
import { snap } from './helpers/snapshotTools.js';
import { writeFile } from 'fs/promises';
import path from 'path';

/**
 * After vault_undo_last_mutation (soft reset), restore working tree
 * to match HEAD so that refresh_index sees the reverted state.
 * The soft reset moved HEAD back but left files staged/on disk.
 * A hard reset to HEAD restores both index and working tree.
 */
async function restoreWorkingTree(vaultPath: string): Promise<void> {
  const git = simpleGit(vaultPath);
  await git.reset(['--hard', 'HEAD']);
}

describe('undo traces', () => {
  describe('undo create reverses effects', () => {
    let ctx: WriteTestServerContext;
    let client: TestClient;

    beforeAll(async () => {
      ctx = await createWriteTestServer();
      client = connectTestClient(ctx.server);

      // Init git
      const git = simpleGit(ctx.vaultPath);
      await git.init();
      await git.addConfig('user.email', 'test@test.com');
      await git.addConfig('user.name', 'Test');
      await writeFile(path.join(ctx.vaultPath, '.gitignore'), '.flywheel/\n');

      // Seed vault with one note
      await createTestNote(ctx.vaultPath, 'notes/existing.md', [
        '---',
        'type: note',
        '---',
        '',
        '# Existing',
        '',
        'An existing note.',
      ].join('\n'));

      await snap(client, 'refresh_index');

      // Commit initial state
      await git.add('.');
      await git.commit('initial');
    }, 30_000);

    afterAll(async () => {
      await ctx?.cleanup();
    });

    it('undo restores total_notes to original count', async () => {
      const statsBefore = await snap(client, 'doctor', { action: 'stats' });

      // Create a note with commit (undo point)
      await snap(client, 'note', {
        action: 'create',
        path: 'notes/undoable.md',
        content: '# Undoable\n\nThis will be undone.',
        frontmatter: { type: 'note' },
        commit: true,
      });
      await snap(client, 'refresh_index');

      const statsAfter = await snap(client, 'doctor', { action: 'stats' });
      expect(statsAfter.total_notes).toBe(statsBefore.total_notes + 1);

      // Undo (soft reset)
      const undoResult = await snap(client, 'correct', { action: 'undo' });
      expect(undoResult.success).toBe(true);

      // Restore working tree to match HEAD
      await restoreWorkingTree(ctx.vaultPath);
      await snap(client, 'refresh_index');

      const statsRestored = await snap(client, 'doctor', { action: 'stats' });
      expect(statsRestored.total_notes).toBe(statsBefore.total_notes);
    });
  });

  describe('undo add_to_section reverses content', () => {
    let ctx: WriteTestServerContext;
    let client: TestClient;

    beforeAll(async () => {
      ctx = await createWriteTestServer();
      client = connectTestClient(ctx.server);

      // Init git
      const git = simpleGit(ctx.vaultPath);
      await git.init();
      await git.addConfig('user.email', 'test@test.com');
      await git.addConfig('user.name', 'Test');
      await writeFile(path.join(ctx.vaultPath, '.gitignore'), '.flywheel/\n');

      // Seed vault
      await createTestNote(ctx.vaultPath, 'notes/sectioned.md', [
        '---',
        'type: note',
        '---',
        '',
        '# Sectioned',
        '',
        '## Log',
        '',
        '- Original entry',
      ].join('\n'));

      await snap(client, 'refresh_index');

      // Commit initial state
      await git.add('.');
      await git.commit('initial');
    }, 30_000);

    afterAll(async () => {
      await ctx?.cleanup();
    });

    it('undo removes added section content', async () => {
      // Add content with commit
      await snap(client, 'edit_section', {
        action: 'add',
        path: 'notes/sectioned.md',
        section: 'Log',
        content: 'undoable content xyz',
        commit: true,
      });

      // Verify content was added
      const contentAfter = await snap(client, 'note_read', {
        action: 'section',
        path: 'notes/sectioned.md',
        heading: 'Log',
      });
      expect(contentAfter.content).toContain('undoable content xyz');

      // Undo (soft reset)
      const undoResult = await snap(client, 'correct', { action: 'undo' });
      expect(undoResult.success).toBe(true);

      // Restore working tree
      await restoreWorkingTree(ctx.vaultPath);
      await snap(client, 'refresh_index');

      const contentRestored = await snap(client, 'note_read', {
        action: 'section',
        path: 'notes/sectioned.md',
        heading: 'Log',
      });
      expect(contentRestored.content).not.toContain('undoable content xyz');
    });
  });

  describe('undo frontmatter update reverses schema', () => {
    let ctx: WriteTestServerContext;
    let client: TestClient;

    beforeAll(async () => {
      ctx = await createWriteTestServer();
      client = connectTestClient(ctx.server);

      // Init git
      const git = simpleGit(ctx.vaultPath);
      await git.init();
      await git.addConfig('user.email', 'test@test.com');
      await git.addConfig('user.name', 'Test');
      await writeFile(path.join(ctx.vaultPath, '.gitignore'), '.flywheel/\n');

      // Seed vault with a person note
      await createTestNote(ctx.vaultPath, 'people/robo.md', [
        '---',
        'type: person',
        '---',
        '',
        '# Robo',
        '',
        'A person who may become a robot.',
      ].join('\n'));

      await snap(client, 'refresh_index');

      // Commit initial state
      await git.add('.');
      await git.commit('initial');
    }, 30_000);

    afterAll(async () => {
      await ctx?.cleanup();
    });

    it('undo restores original type in schema', async () => {
      // Snapshot schema before
      const schemaBefore = await snap(client, 'schema', { action: 'field_values', field: 'type' });
      const valuesBefore = schemaBefore.values.map((v: any) => v.value);
      expect(valuesBefore).toContain('person');

      // Update frontmatter with commit
      await snap(client, 'vault_update_frontmatter', {
        path: 'people/robo.md',
        frontmatter: { type: 'robot' },
        commit: true,
      });
      await snap(client, 'refresh_index');

      // Verify robot appeared
      const schemaAfter = await snap(client, 'schema', { action: 'field_values', field: 'type' });
      const valuesAfter = schemaAfter.values.map((v: any) => v.value);
      expect(valuesAfter).toContain('robot');

      // Undo (soft reset)
      const undoResult = await snap(client, 'correct', { action: 'undo' });
      expect(undoResult.success).toBe(true);

      // Restore working tree
      await restoreWorkingTree(ctx.vaultPath);
      await snap(client, 'refresh_index');

      // Verify person is back, robot is gone
      const schemaRestored = await snap(client, 'schema', { action: 'field_values', field: 'type' });
      const valuesRestored = schemaRestored.values.map((v: any) => v.value);
      expect(valuesRestored).toContain('person');
      expect(valuesRestored).not.toContain('robot');
    });
  });
});

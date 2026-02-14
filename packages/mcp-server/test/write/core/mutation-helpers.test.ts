/**
 * Tests for mutation helpers
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  withVaultFile,
  withVaultFrontmatter,
  formatMcpResult,
  errorResult,
  successResult,
  ensureFileExists,
  ensureSectionExists,
} from '../../src/core/mutation-helpers.js';
import {
  createTempVault,
  cleanupTempVault,
  createTestNote,
} from '../helpers/testUtils.js';
import type { MutationResult } from '../../src/core/types.js';

describe('mutation-helpers', () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = await createTempVault();

    await createTestNote(vaultPath, 'test-note.md', `---
title: Test Note
---
# Test Note

## Log

- Entry 1

## Tasks

- [ ] Task 1
`);

    await createTestNote(vaultPath, 'no-frontmatter.md', `# Simple Note

Just content.
`);

    await createTestNote(vaultPath, 'no-sections.md', `This file has no headings at all.

Just plain text.
`);
  });

  afterEach(async () => {
    await cleanupTempVault(vaultPath);
  });

  describe('formatMcpResult', () => {
    it('wraps result in MCP format', () => {
      const result: MutationResult = {
        success: true,
        message: 'Test',
        path: 'test.md',
      };
      const mcpResult = formatMcpResult(result);

      expect(mcpResult.content).toHaveLength(1);
      expect(mcpResult.content[0].type).toBe('text');
      expect(JSON.parse(mcpResult.content[0].text)).toMatchObject({
        success: true,
        message: 'Test',
        path: 'test.md',
      });
    });

    it('adds tokensEstimate if missing', () => {
      const result: MutationResult = {
        success: true,
        message: 'Test',
        path: 'test.md',
      };
      const mcpResult = formatMcpResult(result);
      const parsed = JSON.parse(mcpResult.content[0].text);

      expect(parsed.tokensEstimate).toBeGreaterThan(0);
    });
  });

  describe('errorResult', () => {
    it('creates error with required fields', () => {
      const result = errorResult('test.md', 'Something failed');

      expect(result.success).toBe(false);
      expect(result.message).toBe('Something failed');
      expect(result.path).toBe('test.md');
      expect(result.tokensEstimate).toBeGreaterThan(0);
    });

    it('merges extras', () => {
      const result = errorResult('test.md', 'Failed', { preview: 'preview text' });

      expect(result.preview).toBe('preview text');
    });
  });

  describe('successResult', () => {
    it('creates success with git info', () => {
      const result = successResult('test.md', 'Done', {
        gitCommit: 'abc123',
        undoAvailable: true,
      });

      expect(result.success).toBe(true);
      expect(result.message).toBe('Done');
      expect(result.gitCommit).toBe('abc123');
      expect(result.undoAvailable).toBe(true);
    });

    it('merges extras', () => {
      const result = successResult('test.md', 'Done', {}, { preview: 'changes' });

      expect(result.preview).toBe('changes');
    });
  });

  describe('ensureFileExists', () => {
    it('returns null for existing file', async () => {
      const result = await ensureFileExists(vaultPath, 'test-note.md');
      expect(result).toBeNull();
    });

    it('returns error for missing file', async () => {
      const result = await ensureFileExists(vaultPath, 'nonexistent.md');

      expect(result).not.toBeNull();
      expect(result!.success).toBe(false);
      expect(result!.message).toContain('File not found');
    });
  });

  describe('ensureSectionExists', () => {
    it('returns boundary for existing section', () => {
      const content = '# Title\n\n## Log\n\nContent\n';
      const result = ensureSectionExists(content, 'Log', 'test.md');

      expect('boundary' in result).toBe(true);
      if ('boundary' in result) {
        expect(result.boundary.name).toBe('Log');
      }
    });

    it('returns error for missing section with suggestions', () => {
      const content = '# Title\n\n## Tasks\n\n## Notes\n';
      const result = ensureSectionExists(content, 'Log', 'test.md');

      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.error.message).toContain('not found');
        expect(result.error.message).toContain('Tasks');
        expect(result.error.message).toContain('Notes');
      }
    });

    it('returns error for file without headings', () => {
      const content = 'No headings here.\n\nJust text.';
      const result = ensureSectionExists(content, 'Log', 'test.md');

      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.error.message).toContain('no headings');
        expect(result.error.message).toContain('section structure');
      }
    });
  });

  describe('withVaultFile', () => {
    it('provides file context to operation', async () => {
      let capturedCtx: any;

      await withVaultFile(
        {
          vaultPath,
          notePath: 'test-note.md',
          commit: false,
          commitPrefix: '[Test]',
          actionDescription: 'test',
        },
        async (ctx) => {
          capturedCtx = ctx;
          return {
            updatedContent: ctx.content,
            message: 'Done',
          };
        }
      );

      expect(capturedCtx.content).toContain('# Test Note');
      expect(capturedCtx.frontmatter.title).toBe('Test Note');
      expect(capturedCtx.vaultPath).toBe(vaultPath);
      expect(capturedCtx.notePath).toBe('test-note.md');
    });

    it('provides section boundary when requested', async () => {
      let capturedCtx: any;

      await withVaultFile(
        {
          vaultPath,
          notePath: 'test-note.md',
          commit: false,
          commitPrefix: '[Test]',
          section: 'Log',
          actionDescription: 'test',
        },
        async (ctx) => {
          capturedCtx = ctx;
          return {
            updatedContent: ctx.content,
            message: 'Done',
          };
        }
      );

      expect(capturedCtx.sectionBoundary).toBeDefined();
      expect(capturedCtx.sectionBoundary.name).toBe('Log');
    });

    it('returns error for missing file', async () => {
      const result = await withVaultFile(
        {
          vaultPath,
          notePath: 'nonexistent.md',
          commit: false,
          commitPrefix: '[Test]',
          actionDescription: 'test',
        },
        async () => ({
          updatedContent: '',
          message: 'Should not reach here',
        })
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.message).toContain('File not found');
    });

    it('returns error for missing section', async () => {
      const result = await withVaultFile(
        {
          vaultPath,
          notePath: 'test-note.md',
          commit: false,
          commitPrefix: '[Test]',
          section: 'NonExistent',
          actionDescription: 'test',
        },
        async () => ({
          updatedContent: '',
          message: 'Should not reach here',
        })
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.message).toContain('not found');
    });

    it('writes updated content', async () => {
      await withVaultFile(
        {
          vaultPath,
          notePath: 'test-note.md',
          commit: false,
          commitPrefix: '[Test]',
          actionDescription: 'test',
        },
        async (ctx) => ({
          updatedContent: ctx.content + '\n## New Section\n',
          message: 'Added section',
        })
      );

      // Verify by reading again
      let newContent: string = '';
      await withVaultFile(
        {
          vaultPath,
          notePath: 'test-note.md',
          commit: false,
          commitPrefix: '[Test]',
          actionDescription: 'verify',
        },
        async (ctx) => {
          newContent = ctx.content;
          return { updatedContent: ctx.content, message: 'Read' };
        }
      );

      expect(newContent).toContain('## New Section');
    });

    it('handles operation errors gracefully', async () => {
      const result = await withVaultFile(
        {
          vaultPath,
          notePath: 'test-note.md',
          commit: false,
          commitPrefix: '[Test]',
          actionDescription: 'process content',
        },
        async () => {
          throw new Error('Operation failed');
        }
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.message).toContain('Failed to process content');
      expect(parsed.message).toContain('Operation failed');
    });

    it('passes through validation info', async () => {
      const result = await withVaultFile(
        {
          vaultPath,
          notePath: 'test-note.md',
          commit: false,
          commitPrefix: '[Test]',
          actionDescription: 'test',
        },
        async (ctx) => ({
          updatedContent: ctx.content,
          message: 'Done',
          warnings: [{ type: 'test', message: 'Warning', suggestion: 'Fix it' }],
          outputIssues: [{ type: 'test', severity: 'warning' as const, message: 'Issue' }],
        })
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.warnings).toHaveLength(1);
      expect(parsed.outputIssues).toHaveLength(1);
    });
  });

  describe('withVaultFrontmatter', () => {
    it('updates frontmatter only', async () => {
      await withVaultFrontmatter(
        {
          vaultPath,
          notePath: 'test-note.md',
          commit: false,
          commitPrefix: '[Test:FM]',
          actionDescription: 'update frontmatter',
        },
        async (ctx) => ({
          updatedFrontmatter: { ...ctx.frontmatter, status: 'updated' },
          message: 'Updated status',
        })
      );

      // Verify
      let updatedFm: any;
      await withVaultFile(
        {
          vaultPath,
          notePath: 'test-note.md',
          commit: false,
          commitPrefix: '[Test]',
          actionDescription: 'verify',
        },
        async (ctx) => {
          updatedFm = ctx.frontmatter;
          return { updatedContent: ctx.content, message: 'Read' };
        }
      );

      expect(updatedFm.status).toBe('updated');
      expect(updatedFm.title).toBe('Test Note'); // Original preserved
    });

    it('returns error for missing file', async () => {
      const result = await withVaultFrontmatter(
        {
          vaultPath,
          notePath: 'nonexistent.md',
          commit: false,
          commitPrefix: '[Test:FM]',
          actionDescription: 'update frontmatter',
        },
        async (ctx) => ({
          updatedFrontmatter: ctx.frontmatter,
          message: 'Should not reach',
        })
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.message).toContain('File not found');
    });
  });
});

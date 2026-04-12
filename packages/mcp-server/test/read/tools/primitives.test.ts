/**
 * Unit tests for primitives tools — note_read and tasks.
 *
 * note_read covers:
 *   action=structure — heading outline + frontmatter + metadata
 *   action=section   — single section by heading name
 *   action=sections  — vault-wide heading regex search
 *   Missing required params → clean read-side error JSON (no formatMcpResult wrapper)
 *
 * tasks covers:
 *   action=list   — vault-wide and path-scoped task queries with status filters
 *   action=toggle — check/uncheck a task by path + text match (uses write server)
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { connectTestClient, type TestClient, createTestServer, type TestServerContext } from '../helpers/createTestServer.js';
import { createWriteTestServer, type WriteTestServerContext } from '../../helpers/createWriteTestServer.js';
import { createTempVault, createTestNote, cleanupTempVault } from '../../write/helpers/testUtils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = path.join(__dirname, '..', 'fixtures');

// ── note_read ─────────────────────────────────────────────────────────────────

describe('note_read', () => {
  let context: TestServerContext;
  let client: TestClient;

  beforeAll(async () => {
    context = await createTestServer(FIXTURES_PATH);
    client = connectTestClient(context.server);
  });

  // ── action=structure ───────────────────────────────────────────

  describe('action=structure', () => {
    test('returns outline fields for a known note', async () => {
      const result = await client.callTool('note_read', {
        action: 'structure',
        path: 'Acme Corp.md',
      });
      const data = JSON.parse(result.content[0].text);

      expect(data.path).toBe('Acme Corp.md');
      expect(data.frontmatter).toBeDefined();
      expect(data.frontmatter.type).toBe('company');
      expect(data.sections).toBeDefined();
      expect(Array.isArray(data.sections)).toBe(true);
      expect(data.backlink_count).toBeDefined();
      expect(typeof data.word_count).toBe('number');
    });

    test('returns sections for a note with multiple headings', async () => {
      const result = await client.callTool('note_read', {
        action: 'structure',
        path: 'normal-note.md',
      });
      const data = JSON.parse(result.content[0].text);

      // Top-level sections (H1 = 1 section); H2s are nested as subsections
      expect(data.sections.length).toBeGreaterThanOrEqual(1);
      // Flatten to find all headings at any depth
      function allHeadings(secs: any[]): string[] {
        return secs.flatMap((s: any) => [
          s.heading?.text ?? s.heading,
          ...allHeadings(s.subsections ?? []),
        ]);
      }
      const headingTexts = allHeadings(data.sections);
      expect(headingTexts).toContain('Section with code');
      expect(headingTexts).toContain('More content');
    });

    test('missing path returns error JSON without formatMcpResult wrapper', async () => {
      const result = await client.callTool('note_read', {
        action: 'structure',
      });
      const data = JSON.parse(result.content[0].text);

      expect(data.error).toBeDefined();
      expect(typeof data.error).toBe('string');
      // Must NOT have write-side MutationResult shape
      expect(data.success).toBeUndefined();
    });
  });

  // ── action=section ─────────────────────────────────────────────

  describe('action=section', () => {
    test('returns content under a specific heading', async () => {
      const result = await client.callTool('note_read', {
        action: 'section',
        path: 'normal-note.md',
        heading: 'Section with code',
      });
      const data = JSON.parse(result.content[0].text);

      expect(data.content).toBeDefined();
      expect(typeof data.content).toBe('string');
      expect(data.content.length).toBeGreaterThan(0);
    });

    test('missing path returns error JSON', async () => {
      const result = await client.callTool('note_read', {
        action: 'section',
        heading: 'Section with code',
      });
      const data = JSON.parse(result.content[0].text);

      expect(data.error).toBeDefined();
      expect(data.success).toBeUndefined();
    });

    test('missing heading returns error JSON', async () => {
      const result = await client.callTool('note_read', {
        action: 'section',
        path: 'normal-note.md',
      });
      const data = JSON.parse(result.content[0].text);

      expect(data.error).toBeDefined();
      expect(data.success).toBeUndefined();
    });
  });

  // ── action=sections ────────────────────────────────────────────

  describe('action=sections', () => {
    test('returns matching sections across the vault', async () => {
      const result = await client.callTool('note_read', {
        action: 'sections',
        pattern: 'Section with code',
      });
      const data = JSON.parse(result.content[0].text);

      expect(data.sections).toBeDefined();
      expect(Array.isArray(data.sections)).toBe(true);
      expect(data.total_count).toBeDefined();
      expect(data.sections.length).toBeGreaterThanOrEqual(1);
    });

    test('returns empty sections array for non-matching pattern', async () => {
      const result = await client.callTool('note_read', {
        action: 'sections',
        pattern: 'ZZZNoSuchHeadingXXX',
      });
      const data = JSON.parse(result.content[0].text);

      expect(data.sections).toBeDefined();
      expect(data.sections.length).toBe(0);
    });

    test('missing pattern returns error JSON', async () => {
      const result = await client.callTool('note_read', {
        action: 'sections',
      });
      const data = JSON.parse(result.content[0].text);

      expect(data.error).toBeDefined();
      expect(data.success).toBeUndefined();
    });
  });
});

// ── tasks ─────────────────────────────────────────────────────────────────────
// Both list and toggle use a shared write-capable server with a temp vault.
// This avoids CRLF/path-separator issues with fixtures on Windows and ensures
// tasks are indexed before the server starts.

describe('tasks', () => {
  let writeContext: WriteTestServerContext;
  let writeClient: TestClient;

  beforeAll(async () => {
    // Create note BEFORE createWriteTestServer so buildVaultIndex picks it up
    const tempVaultPath = await createTempVault();
    await createTestNote(
      tempVaultPath,
      'tasks-note.md',
      '# Tasks Note\n\n- [ ] Open task one\n- [ ] Open task two\n- [x] Done task\n'
    );
    writeContext = await createWriteTestServer(tempVaultPath);
    writeClient = connectTestClient(writeContext.server);
  });

  afterAll(async () => {
    if (writeContext) await writeContext.cleanup();
  });

  // ── action=list ────────────────────────────────────────────────

  describe('action=list', () => {
    test('returns tasks array with correct shape', async () => {
      const result = await writeClient.callTool('tasks', {
        action: 'list',
        path: 'tasks-note.md',
      });
      const data = JSON.parse(result.content[0].text);

      expect(data.tasks).toBeDefined();
      expect(Array.isArray(data.tasks)).toBe(true);
      expect(data.tasks.length).toBeGreaterThan(0);
      const task = data.tasks[0];
      expect(typeof task.text).toBe('string');
      expect(typeof task.status).toBe('string');
      expect(typeof task.path).toBe('string');
    });

    test('status: "open" filter returns only open tasks', async () => {
      const result = await writeClient.callTool('tasks', {
        action: 'list',
        path: 'tasks-note.md',
        status: 'open',
      });
      const data = JSON.parse(result.content[0].text);

      expect(Array.isArray(data.tasks)).toBe(true);
      expect(data.tasks.every((t: any) => t.status === 'open')).toBe(true);
      expect(data.tasks.some((t: any) => t.text.includes('Open task one'))).toBe(true);
    });

    test('status: "completed" filter returns only completed tasks', async () => {
      const result = await writeClient.callTool('tasks', {
        action: 'list',
        path: 'tasks-note.md',
        status: 'completed',
      });
      const data = JSON.parse(result.content[0].text);

      expect(Array.isArray(data.tasks)).toBe(true);
      expect(data.tasks.every((t: any) => t.status === 'completed')).toBe(true);
      expect(data.tasks.some((t: any) => t.text.includes('Done task'))).toBe(true);
    });

    test('path not found returns error JSON', async () => {
      const result = await writeClient.callTool('tasks', {
        action: 'list',
        path: 'does-not-exist.md',
      });
      const data = JSON.parse(result.content[0].text);

      expect(data.error).toBeDefined();
      expect(data.success).toBeUndefined();
    });
  });

  // ── action=toggle ──────────────────────────────────────────────

  describe('action=toggle', () => {
    test('dry_run: true does not modify the file', async () => {
      const { readFile } = await import('fs/promises');

      const result = await writeClient.callTool('tasks', {
        action: 'toggle',
        path: 'tasks-note.md',
        task: 'Open task one',
        dry_run: true,
      });
      const data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(true);
      expect(data.preview).toBeDefined();
      expect(data.dryRun).toBe(true);

      const content = await readFile(path.join(writeContext.vaultPath, 'tasks-note.md'), 'utf8');
      expect(content).toContain('- [ ] Open task one');
    });

    test('toggling an open task marks it done', async () => {
      const { readFile } = await import('fs/promises');

      const result = await writeClient.callTool('tasks', {
        action: 'toggle',
        path: 'tasks-note.md',
        task: 'Open task two',
      });
      const data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(true);

      const content = await readFile(path.join(writeContext.vaultPath, 'tasks-note.md'), 'utf8');
      expect(content).toContain('- [x] Open task two');
    });

    test('missing path returns an error', async () => {
      const result = await writeClient.callTool('tasks', {
        action: 'toggle',
        task: 'Open task one',
      });
      const data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(false);
      expect(data.message).toBeDefined();
    });

    test('task text not found returns an error', async () => {
      const result = await writeClient.callTool('tasks', {
        action: 'toggle',
        path: 'tasks-note.md',
        task: 'This task does not exist',
      });
      const data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(false);
      expect(data.message).toBeDefined();
    });
  });
});

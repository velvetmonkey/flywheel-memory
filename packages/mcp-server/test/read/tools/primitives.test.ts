/**
 * Unit tests for note_read tool — action routing and error handling.
 *
 * Covers:
 *   action=structure — heading outline + frontmatter + metadata
 *   action=section   — single section by heading name
 *   action=sections  — vault-wide heading regex search
 *   Missing required params → clean read-side error JSON (no formatMcpResult wrapper)
 */

import { describe, test, expect, beforeAll } from 'vitest';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { connectTestClient, type TestClient, createTestServer, type TestServerContext } from '../helpers/createTestServer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = path.join(__dirname, '..', 'fixtures');

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

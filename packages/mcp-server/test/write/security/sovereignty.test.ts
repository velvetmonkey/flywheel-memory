/**
 * Sovereignty enforcement tests
 *
 * Validates cognitive sovereignty guarantees:
 * - No outbound network calls in default configuration
 * - All write operations produce auditable records
 * - Network call sites are documented and intentional
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs/promises';
import path from 'path';

const SRC_DIR = path.join(__dirname, '../../../src');

/**
 * Recursively collect all .ts source files under a directory
 */
async function collectTsFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== 'dist') {
      results.push(...await collectTsFiles(fullPath));
    } else if (entry.name.endsWith('.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

// Known allowed network call sites (file path substring => reason)
const ALLOWED_NETWORK_SITES: Record<string, string> = {
  'core/read/embeddings.ts': '@huggingface/transformers model download (one-time, cached locally)',
};

// Network call patterns to detect
const NETWORK_PATTERNS = [
  /\bfetch\s*\(/,
  /\bhttp\.request\b/,
  /\bhttps\.request\b/,
  /\baxios\b/,
  /\bnode-fetch\b/,
  /\bundici\b/,
  /\bnet\.connect\b/,
  /\bnet\.createConnection\b/,
  /\bdns\.lookup\b/,
  /\bdns\.resolve\b/,
  /\bnew\s+WebSocket\b/,
  /\bgot\s*\(/,
];

describe('Cognitive Sovereignty', () => {
  describe('no outbound network in production code', () => {
    it('should have no unaudited network calls in src/', async () => {
      const files = await collectTsFiles(SRC_DIR);
      const violations: { file: string; line: number; text: string }[] = [];

      for (const file of files) {
        const relativePath = path.relative(SRC_DIR, file).replace(/\\/g, '/');
        const isAllowed = Object.keys(ALLOWED_NETWORK_SITES).some(
          allowed => relativePath.includes(allowed)
        );
        if (isAllowed) continue;

        const content = await fs.readFile(file, 'utf-8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const trimmed = line.trimStart();
          if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
          for (const pattern of NETWORK_PATTERNS) {
            if (pattern.test(line)) {
              violations.push({ file: relativePath, line: i + 1, text: trimmed });
            }
          }
        }
      }

      expect(violations, `Found unaudited network calls:\n${
        violations.map(v => `  ${v.file}:${v.line}: ${v.text}`).join('\n')
      }`).toHaveLength(0);
    });

    it('allowed network sites should exist in source', async () => {
      const files = await collectTsFiles(SRC_DIR);

      for (const fileSuffix of Object.keys(ALLOWED_NETWORK_SITES)) {
        const found = files.some(f =>
          path.relative(SRC_DIR, f).replace(/\\/g, '/').includes(fileSuffix)
        );
        expect(found, `Allowed network site "${fileSuffix}" not found in source — remove from allowlist`).toBe(true);
      }
    });

    it('should not use git remote operations', async () => {
      const files = await collectTsFiles(SRC_DIR);
      const remoteOps = /\.(?:push|pull|fetch|clone)\s*\(/;
      const violations: string[] = [];

      for (const file of files) {
        const content = await fs.readFile(file, 'utf-8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const trimmed = lines[i].trimStart();
          if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
          if (remoteOps.test(trimmed)) {
            // Exclude array.push, Map.push, etc. — only flag git.push patterns
            if (/git.*\.(?:push|pull|fetch|clone)\s*\(/.test(trimmed) ||
                /simple-?git.*\.(?:push|pull|fetch|clone)/.test(trimmed)) {
              violations.push(`${path.relative(SRC_DIR, file)}:${i + 1}: ${trimmed}`);
            }
          }
        }
      }

      expect(violations, `Found git remote operations:\n${violations.join('\n')}`).toHaveLength(0);
    });
  });

  describe('audit trail completeness', () => {
    it('tool-registry records invocations for all tool calls', async () => {
      const registryPath = path.join(SRC_DIR, 'tool-registry.ts');
      const content = await fs.readFile(registryPath, 'utf-8');

      expect(content).toContain('recordToolInvocation');
      // Recording must happen in a finally block (runs even on failure)
      expect(content).toContain('} finally {');
    });

    it('tool_invocations schema captures essential audit fields', async () => {
      const schemaPath = path.join(__dirname, '../../../../core/src/schema.ts');
      const content = await fs.readFile(schemaPath, 'utf-8');

      expect(content).toContain('tool_invocations');
      expect(content).toContain('timestamp INTEGER NOT NULL');
      expect(content).toContain('tool_name TEXT NOT NULL');
      expect(content).toContain('session_id');
      expect(content).toContain('duration_ms');
      expect(content).toContain('success');
    });

    it('write operations produce git commits', async () => {
      const gitPath = path.join(SRC_DIR, 'core/write/git.ts');
      const content = await fs.readFile(gitPath, 'utf-8');

      expect(content).toContain('commitChange');
      expect(content).toContain('simpleGit');
      // Should NOT have remote push operations
      expect(content).not.toMatch(/\.push\s*\(/);
    });
  });
});

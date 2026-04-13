import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '../../../..');

const TARGET_FILES = [
  'README.md',
  'CLAUDE.md',
  'docs/README.md',
  'docs/TOOLS.md',
  'docs/CONFIGURATION.md',
  'docs/SETUP.md',
  'docs/ARCHITECTURE.md',
  'docs/ALGORITHM.md',
] as const;

const STALE_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /progressive disclosure via `discover_tools`/i, message: 'old progressive-disclosure copy should be removed' },
  { pattern: /read or update via the `flywheel_config` tool/i, message: 'public docs should refer to doctor(action: "config") instead of flywheel_config' },
  { pattern: /65-tool|65 tool/i, message: 'hard-coded old tool counts should be removed' },
  { pattern: /discover_tools[^.\n]*(activates|reveals|unlocks)/i, message: 'discover_tools should not be documented as activating tools' },
];

describe('stale doc language guard', () => {
  for (const rel of TARGET_FILES) {
    it(`${rel} avoids stale tool-model language`, () => {
      const content = readFileSync(join(REPO_ROOT, rel), 'utf-8');
      for (const { pattern, message } of STALE_PATTERNS) {
        expect(content, `${rel}: ${message}`).not.toMatch(pattern);
      }
    });
  }
});

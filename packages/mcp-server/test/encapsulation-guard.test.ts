import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const PRIVATE_REGISTERED_TOOLS = `_${'registeredTools'}`;
const PRIVATE_REQUEST_HANDLERS = `_${'requestHandlers'}`;
const CHECK_PATHS = [
  'src/tool-registry.ts',
  'test/tool-tiering.test.ts',
  'test/tool-sets.test.ts',
  'test/write/core/http-pool.test.ts',
];

describe('encapsulation guard', () => {
  it('does not rely on MCP SDK private registry fields in runtime or key tests', () => {
    for (const relativePath of CHECK_PATHS) {
      const contents = readFileSync(join(ROOT, relativePath), 'utf-8');
      expect(contents).not.toContain(PRIVATE_REGISTERED_TOOLS);
      expect(contents).not.toContain(PRIVATE_REQUEST_HANDLERS);
    }
  });
});

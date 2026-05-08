/**
 * Regression tests for isBinaryContent in parser.ts.
 *
 * 2026-05-08: emoji-heavy markdown (e.g. daily notes containing engine log
 * markers like 🐵) was being falsely flagged as binary because the previous
 * heuristic counted every UTF-8 multi-byte sequence as non-printable. Today's
 * daily note was rejected 300 times before this fix landed.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { parseNoteWithWarnings } from '../../src/core/read/parser.js';
import type { VaultFile } from '../../src/core/read/vault.js';

let tmpDir: string;

async function makeFile(name: string, contents: Buffer | string): Promise<VaultFile> {
  const absolutePath = path.join(tmpDir, name);
  await fs.writeFile(absolutePath, contents);
  return { path: name, absolutePath };
}

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fw-binary-detect-'));
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('isBinaryContent (regression coverage)', () => {
  it('accepts emoji-heavy markdown', async () => {
    const content = `---
type: daily
---
# Log
- **00:01** 🐵 @thevelvetmonke (21.1s, sonnet) — note 🎉
- **00:02** 🐵 reply 🚀
- **00:03** 🐵 reply 💡
${'- 🐵 entry 🍌\n'.repeat(50)}
`;
    const file = await makeFile('emoji-daily.md', content);
    const result = await parseNoteWithWarnings(file);
    expect(result.skipped).toBe(false);
    expect(result.skipReason).toBeUndefined();
  });

  it('accepts plain ASCII markdown', async () => {
    const content = `---
type: note
---
# Plain
Just ordinary words and [[wikilinks]].
`;
    const file = await makeFile('plain.md', content);
    const result = await parseNoteWithWarnings(file);
    expect(result.skipped).toBe(false);
  });

  it('rejects PNG bytes (null bytes in IHDR)', async () => {
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00, 0x10,
    ]);
    const file = await makeFile('image.md', png);
    const result = await parseNoteWithWarnings(file);
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe('Binary content detected');
  });

  it('rejects PDF bytes (null bytes in xref)', async () => {
    const pdf = Buffer.concat([
      Buffer.from('%PDF-1.4\n'),
      Buffer.from([0x00, 0x00, 0x00]),
      Buffer.from('1 0 obj\n<< >>\nendobj\n'),
    ]);
    const file = await makeFile('doc.md', pdf);
    const result = await parseNoteWithWarnings(file);
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe('Binary content detected');
  });
});

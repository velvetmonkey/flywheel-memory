#!/usr/bin/env node

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const requestedVersion = process.argv[2] || 'latest';
const packageSpec = `@velvetmonkey/flywheel-memory@${requestedVersion}`;
const tempDir = mkdtempSync(join(tmpdir(), 'flywheel-codex-smoke-'));
const vaultDir = join(tempDir, 'vault');
mkdirSync(join(vaultDir, '.obsidian'), { recursive: true });
writeFileSync(join(vaultDir, 'Inbox.md'), '# Inbox\n\nRegistry smoke test.\n');

const stderr = [];
const transport = new StdioClientTransport({
  command: 'npx',
  args: ['-y', packageSpec],
  cwd: tempDir,
  env: {
    PROJECT_PATH: vaultDir,
    FLYWHEEL_PRESET: 'full',
  },
  stderr: 'pipe',
});

transport.stderr?.on('data', chunk => {
  stderr.push(chunk.toString());
});

const client = new Client({
  name: 'codex-post-publish-smoke',
  version: '1.0.0',
}, {
  capabilities: {},
});

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const toolNames = new Set(tools.tools.map(tool => tool.name));

  const required = ['search', 'vault_create_note', 'flywheel_doctor'];
  const missing = required.filter(name => !toolNames.has(name));
  if (missing.length > 0) {
    throw new Error(`Missing expected tools: ${missing.join(', ')}`);
  }

  console.log(
    JSON.stringify(
      {
        package: packageSpec,
        tool_count: toolNames.size,
        required_tools: required,
        startup_log: stderr.join('').split('\n').filter(Boolean).slice(-10),
      },
      null,
      2,
    ),
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  if (stderr.length > 0) {
    console.error(stderr.join(''));
  }
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
  await transport.close().catch(() => {});
  rmSync(tempDir, { recursive: true, force: true });
}

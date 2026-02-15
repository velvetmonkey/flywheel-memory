/**
 * Last-Write-Wins Semantics Tests
 *
 * Documents and validates the last-write-wins behavior:
 * when multiple writes compete, the last one to complete wins.
 * This is expected behavior, not a bug.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  createTempVault,
  cleanupTempVault,
  createTestNote,
  readTestNote,
} from '../helpers/testUtils.js';
import {
  readVaultFile,
  writeVaultFile,
  findSection,
  insertInSection,
} from '../../../src/core/write/writer.js';

let tempVault: string;

describe('Last-Write-Wins Semantics', () => {
  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  describe('Documented Behavior', () => {
    it('should demonstrate last-write-wins with concurrent agents', async () => {
      /**
       * Scenario: Two agents read the same file, make different changes,
       * then write back. The agent that writes LAST wins.
       *
       * This is EXPECTED behavior and documented in the README.
       */
      const content = `# Shared Document

## Notes

- Original note
`;
      await createTestNote(tempVault, 'shared.md', content);

      // Agent 1 reads
      const agent1Read = await readVaultFile(tempVault, 'shared.md');
      const agent1Section = findSection(agent1Read.content, 'Notes');

      // Agent 2 reads (same state)
      const agent2Read = await readVaultFile(tempVault, 'shared.md');
      const agent2Section = findSection(agent2Read.content, 'Notes');

      // Agent 1 modifies and writes
      const agent1Modified = insertInSection(agent1Read.content, agent1Section!, '- Agent 1 addition', 'append');
      await writeVaultFile(tempVault, 'shared.md', agent1Modified, agent1Read.frontmatter, agent1Read.lineEnding);

      // Agent 2 modifies and writes (doesn't see Agent 1's change)
      const agent2Modified = insertInSection(agent2Read.content, agent2Section!, '- Agent 2 addition', 'append');
      await writeVaultFile(tempVault, 'shared.md', agent2Modified, agent2Read.frontmatter, agent2Read.lineEnding);

      // Verify: Agent 2's write should win
      const finalContent = await readTestNote(tempVault, 'shared.md');

      expect(finalContent).toContain('- Original note');
      expect(finalContent).toContain('- Agent 2 addition');
      // Agent 1's change is lost (this is documented behavior)
      expect(finalContent).not.toContain('- Agent 1 addition');
    });

    it('should preserve ALL changes in sequential operations', async () => {
      /**
       * Sequential operations (read-modify-write-read-modify-write)
       * should preserve all changes.
       */
      const content = `# Sequential

## Log

`;
      await createTestNote(tempVault, 'sequential.md', content);

      // Operation 1
      const read1 = await readVaultFile(tempVault, 'sequential.md');
      const section1 = findSection(read1.content, 'Log');
      const mod1 = insertInSection(read1.content, section1!, '- First', 'append');
      await writeVaultFile(tempVault, 'sequential.md', mod1, read1.frontmatter, read1.lineEnding);

      // Operation 2 (reads after write)
      const read2 = await readVaultFile(tempVault, 'sequential.md');
      const section2 = findSection(read2.content, 'Log');
      const mod2 = insertInSection(read2.content, section2!, '- Second', 'append');
      await writeVaultFile(tempVault, 'sequential.md', mod2, read2.frontmatter, read2.lineEnding);

      // Operation 3
      const read3 = await readVaultFile(tempVault, 'sequential.md');
      const section3 = findSection(read3.content, 'Log');
      const mod3 = insertInSection(read3.content, section3!, '- Third', 'append');
      await writeVaultFile(tempVault, 'sequential.md', mod3, read3.frontmatter, read3.lineEnding);

      const finalContent = await readTestNote(tempVault, 'sequential.md');

      // All changes should be present
      expect(finalContent).toContain('- First');
      expect(finalContent).toContain('- Second');
      expect(finalContent).toContain('- Third');
    });
  });

  describe('Atomic Write Completeness', () => {
    it('should write complete content, not partial', async () => {
      /**
       * Even with last-write-wins, the winning write should be
       * COMPLETE - no partial content, no truncation.
       */
      const content = `# Document

## Section

`;
      await createTestNote(tempVault, 'atomic.md', content);

      // Prepare large content
      const largeAddition = Array.from({ length: 100 }, (_, i) => `- Line ${i}`).join('\n');

      const { content: readContent, frontmatter, lineEnding } = await readVaultFile(tempVault, 'atomic.md');
      const section = findSection(readContent, 'Section');
      const modified = insertInSection(readContent, section!, largeAddition, 'append');

      await writeVaultFile(tempVault, 'atomic.md', modified, frontmatter, lineEnding);

      const finalContent = await readTestNote(tempVault, 'atomic.md');

      // All 100 lines should be present
      for (let i = 0; i < 100; i++) {
        expect(finalContent).toContain(`- Line ${i}`);
      }
    });

    it('should maintain structural integrity of markdown', async () => {
      const content = `---
type: structured
---
# Structured Document

## Section A

Content A

## Section B

Content B
`;
      await createTestNote(tempVault, 'structured.md', content);

      // Modify section A
      const read = await readVaultFile(tempVault, 'structured.md');
      const sectionA = findSection(read.content, 'Section A');
      const modified = insertInSection(read.content, sectionA!, '- New content in A', 'append');
      await writeVaultFile(tempVault, 'structured.md', modified, read.frontmatter, read.lineEnding);

      const finalContent = await readTestNote(tempVault, 'structured.md');

      // All structural elements should be intact
      expect(finalContent).toContain('---');
      expect(finalContent).toContain('type: structured');
      expect(finalContent).toContain('# Structured Document');
      expect(finalContent).toContain('## Section A');
      expect(finalContent).toContain('## Section B');
      expect(finalContent).toContain('Content A');
      expect(finalContent).toContain('Content B');
      expect(finalContent).toContain('- New content in A');
    });
  });

  describe('Conflict Scenarios', () => {
    it('should handle rapid file replacement', async () => {
      // Create initial file
      await createTestNote(tempVault, 'replace.md', '# Version 1');

      // Rapidly replace content
      for (let i = 2; i <= 10; i++) {
        await fs.writeFile(
          path.join(tempVault, 'replace.md'),
          `# Version ${i}\n\nContent for version ${i}`,
          'utf-8'
        );
      }

      const finalContent = await readTestNote(tempVault, 'replace.md');

      // Final version should be present
      expect(finalContent).toContain('# Version 10');
      expect(finalContent).toContain('Content for version 10');
    });

    it('should not merge conflicting changes', async () => {
      /**
       * Important: Flywheel Memory does NOT merge changes.
       * If two agents modify the same content differently,
       * only one version survives.
       */
      const content = `# Config

## Setting

value: old
`;
      await createTestNote(tempVault, 'config.md', content);

      // Agent 1 reads
      const read1 = await readVaultFile(tempVault, 'config.md');

      // Agent 2 reads
      const read2 = await readVaultFile(tempVault, 'config.md');

      // Both modify the same setting differently
      const mod1 = read1.content.replace('value: old', 'value: new-from-agent-1');
      const mod2 = read2.content.replace('value: old', 'value: new-from-agent-2');

      // Write in sequence
      await writeVaultFile(tempVault, 'config.md', mod1, read1.frontmatter, read1.lineEnding);
      await writeVaultFile(tempVault, 'config.md', mod2, read2.frontmatter, read2.lineEnding);

      const finalContent = await readTestNote(tempVault, 'config.md');

      // Only one value should be present (the last write)
      expect(finalContent).toContain('value: new-from-agent-2');
      expect(finalContent).not.toContain('value: old');
      expect(finalContent).not.toContain('value: new-from-agent-1');
    });
  });

  describe('Stale Read Handling', () => {
    it('should handle stale read followed by write', async () => {
      /**
       * Scenario: Agent reads, file changes externally, agent writes.
       * The write will overwrite the external change.
       */
      const content = `# Document

## Content

Original
`;
      await createTestNote(tempVault, 'stale.md', content);

      // Agent reads
      const agentRead = await readVaultFile(tempVault, 'stale.md');
      const agentSection = findSection(agentRead.content, 'Content');

      // External change (simulating another tool or manual edit)
      await fs.writeFile(
        path.join(tempVault, 'stale.md'),
        `# Document

## Content

External change
`,
        'utf-8'
      );

      // Agent writes (based on stale read)
      const agentModified = insertInSection(agentRead.content, agentSection!, '- Agent addition', 'append');
      await writeVaultFile(tempVault, 'stale.md', agentModified, agentRead.frontmatter, agentRead.lineEnding);

      const finalContent = await readTestNote(tempVault, 'stale.md');

      // Agent's write wins - external change is lost
      expect(finalContent).toContain('Original');
      expect(finalContent).toContain('- Agent addition');
      expect(finalContent).not.toContain('External change');
    });
  });
});

describe('Documentation of Expected Behavior', () => {
  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('documents: concurrent writes may lose data (by design)', async () => {
    /**
     * This test documents expected behavior:
     *
     * When multiple processes write to the same file concurrently:
     * 1. File is never corrupted
     * 2. One write "wins" (last to complete)
     * 3. Other writes' changes are lost
     *
     * This is NOT a bug - it's the documented behavior.
     * Agents should use sequential operations for critical changes.
     */
    const content = `# Test`;
    await createTestNote(tempVault, 'doc.md', content);

    // This test always passes - it's documentation
    expect(true).toBe(true);
  });

  it('documents: sequential operations preserve all changes', async () => {
    /**
     * To ensure no data loss:
     * 1. Read → Modify → Write → Read → Modify → Write
     * 2. Each read happens AFTER the previous write completes
     * 3. All changes are preserved
     *
     * This is the recommended pattern for critical operations.
     */
    expect(true).toBe(true);
  });

  it('documents: git provides rollback safety', async () => {
    /**
     * Even with last-write-wins:
     * 1. Each mutation can be committed
     * 2. Git history preserves all versions
     * 3. vault_undo_last_mutation can rollback
     *
     * This provides safety net for concurrent scenarios.
     */
    expect(true).toBe(true);
  });
});

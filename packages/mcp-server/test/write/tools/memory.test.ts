/**
 * Tests for AI Agent Memory features
 * - Scoping parameters (agent_id, session_id) on mutation tools
 * - Metadata injection (_last_modified_at, _modification_count, etc.)
 * - Episodic memory tools (vault_log_interaction, vault_search_interactions)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  readVaultFile,
  writeVaultFile,
  findSection,
  formatContent,
  insertInSection,
  injectMutationMetadata,
} from '../../src/core/writer.js';
import {
  createTempVault,
  cleanupTempVault,
  createTestNote,
  readTestNote,
  createSampleNote,
} from '../helpers/testUtils.js';
import type { FormatType, Position, ScopingMetadata } from '../../src/core/types.js';
import fs from 'fs/promises';
import path from 'path';
import matter from 'gray-matter';

// ========================================
// Test Helpers
// ========================================

/**
 * Helper to simulate the full vault_add_to_section workflow with scoping
 */
async function addToSectionWithScoping(
  vaultPath: string,
  notePath: string,
  sectionName: string,
  content: string,
  position: Position,
  format: FormatType,
  scoping?: ScopingMetadata
): Promise<{ success: boolean; message: string; preview?: string }> {
  try {
    // 1. Read file
    const { content: fileContent, frontmatter } = await readVaultFile(vaultPath, notePath);

    // 2. Find section
    const section = findSection(fileContent, sectionName);
    if (!section) {
      return {
        success: false,
        message: `Section not found: ${sectionName}`,
      };
    }

    // 3. Format content
    const formattedContent = formatContent(content, format);

    // 4. Insert into section
    const updatedContent = insertInSection(fileContent, section, formattedContent, position);

    // 5. Inject scoping metadata if provided
    let finalFrontmatter = frontmatter;
    if (scoping && (scoping.agent_id || scoping.session_id)) {
      finalFrontmatter = injectMutationMetadata(frontmatter, scoping);
    }

    // 6. Write back
    await writeVaultFile(vaultPath, notePath, updatedContent, finalFrontmatter);

    return {
      success: true,
      message: `Added content to section "${section.name}"`,
      preview: formattedContent,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ========================================
// Scoping Metadata Tests
// ========================================

describe.sequential('Agent Scoping Metadata', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  describe('injectMutationMetadata', () => {
    it('should add _last_modified_at timestamp', () => {
      const frontmatter: Record<string, unknown> = { title: 'Test' };
      const before = Date.now();

      const result = injectMutationMetadata(frontmatter);

      const after = Date.now();
      expect(result._last_modified_at).toBeDefined();
      const timestamp = new Date(result._last_modified_at as string).getTime();
      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });

    it('should increment _modification_count', () => {
      const frontmatter: Record<string, unknown> = { title: 'Test' };

      const result1 = injectMutationMetadata(frontmatter);
      expect(result1._modification_count).toBe(1);

      const result2 = injectMutationMetadata(result1);
      expect(result2._modification_count).toBe(2);

      const result3 = injectMutationMetadata(result2);
      expect(result3._modification_count).toBe(3);
    });

    it('should inject agent_id when provided', () => {
      const frontmatter: Record<string, unknown> = { title: 'Test' };
      const scoping: ScopingMetadata = { agent_id: 'claude-opus' };

      const result = injectMutationMetadata(frontmatter, scoping);

      expect(result._agent_id).toBe('claude-opus');
      expect(result._last_modified_by).toBe('agent:claude-opus');
    });

    it('should inject session_id when provided', () => {
      const frontmatter: Record<string, unknown> = { title: 'Test' };
      const scoping: ScopingMetadata = { session_id: 'sess-123' };

      const result = injectMutationMetadata(frontmatter, scoping);

      expect(result._session_id).toBe('sess-123');
      expect(result._last_modified_by).toBe('session:sess-123');
    });

    it('should inject both agent_id and session_id when provided', () => {
      const frontmatter: Record<string, unknown> = { title: 'Test' };
      const scoping: ScopingMetadata = {
        agent_id: 'planning-agent',
        session_id: 'sess-456',
      };

      const result = injectMutationMetadata(frontmatter, scoping);

      expect(result._agent_id).toBe('planning-agent');
      expect(result._session_id).toBe('sess-456');
      expect(result._last_modified_by).toBe('planning-agent:sess-456');
    });

    it('should not add scoping fields when scoping is undefined', () => {
      const frontmatter: Record<string, unknown> = { title: 'Test' };

      const result = injectMutationMetadata(frontmatter);

      expect(result._agent_id).toBeUndefined();
      expect(result._session_id).toBeUndefined();
      expect(result._last_modified_by).toBeUndefined();
      // But should still have modification tracking
      expect(result._last_modified_at).toBeDefined();
      expect(result._modification_count).toBe(1);
    });
  });

  describe('Mutation with scoping parameters', () => {
    it('should add agent_id to frontmatter when mutating', async () => {
      // Create isolated vault for this test
      const localVault = await createTempVault();
      try {
        await createTestNote(localVault, 'test.md', createSampleNote());

        const result = await addToSectionWithScoping(
          localVault,
          'test.md',
          'Log',
          'New entry',
          'append',
          'plain',
          { agent_id: 'claude-opus' }
        );

        expect(result.success).toBe(true);

        // Read back and verify frontmatter
        const { frontmatter } = await readVaultFile(localVault, 'test.md');
        expect(frontmatter._agent_id).toBe('claude-opus');
        expect(frontmatter._last_modified_by).toBe('agent:claude-opus');
        expect(frontmatter._last_modified_at).toBeDefined();
        expect(frontmatter._modification_count).toBe(1);
      } finally {
        await cleanupTempVault(localVault);
      }
    });

    it('should add session_id to frontmatter when mutating', async () => {
      const localVault = await createTempVault();
      try {
        await createTestNote(localVault, 'test.md', createSampleNote());

        const result = await addToSectionWithScoping(
          localVault,
          'test.md',
          'Log',
          'New entry',
          'append',
          'plain',
          { session_id: 'sess-abc123' }
        );

        expect(result.success).toBe(true);

        const { frontmatter } = await readVaultFile(localVault, 'test.md');
        expect(frontmatter._session_id).toBe('sess-abc123');
        expect(frontmatter._last_modified_by).toBe('session:sess-abc123');
      } finally {
        await cleanupTempVault(localVault);
      }
    });

    it('should not add scoping fields when not provided', async () => {
      const localVault = await createTempVault();
      try {
        await createTestNote(localVault, 'test.md', createSampleNote());

        const result = await addToSectionWithScoping(
          localVault,
          'test.md',
          'Log',
          'New entry',
          'append',
          'plain'
          // No scoping parameter
        );

        expect(result.success).toBe(true);

        const { frontmatter } = await readVaultFile(localVault, 'test.md');
        expect(frontmatter._agent_id).toBeUndefined();
        expect(frontmatter._session_id).toBeUndefined();
        expect(frontmatter._last_modified_by).toBeUndefined();
        // Also should not have modification tracking when no scoping
        expect(frontmatter._modification_count).toBeUndefined();
      } finally {
        await cleanupTempVault(localVault);
      }
    });

    it('should track multiple mutations with different agents', async () => {
      const localVault = await createTempVault();
      try {
        await createTestNote(localVault, 'test.md', createSampleNote());

        // First mutation by agent-1
        await addToSectionWithScoping(
          localVault,
          'test.md',
          'Log',
          'Entry from agent-1',
          'append',
          'plain',
          { agent_id: 'agent-1' }
        );

        let { frontmatter } = await readVaultFile(localVault, 'test.md');
        expect(frontmatter._agent_id).toBe('agent-1');
        expect(frontmatter._modification_count).toBe(1);

        // Second mutation by agent-2
        await addToSectionWithScoping(
          localVault,
          'test.md',
          'Log',
          'Entry from agent-2',
          'append',
          'plain',
          { agent_id: 'agent-2' }
        );

        ({ frontmatter } = await readVaultFile(localVault, 'test.md'));
        expect(frontmatter._agent_id).toBe('agent-2');
        expect(frontmatter._modification_count).toBe(2);
      } finally {
        await cleanupTempVault(localVault);
      }
    });
  });
});

// ========================================
// Episodic Memory Tools Tests
// ========================================

describe.sequential('Episodic Memory Tools', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  describe('vault_log_interaction (simulated)', () => {
    /**
     * Simulate vault_log_interaction behavior for testing
     */
    async function logInteraction(
      vaultPath: string,
      params: {
        agent_id: string;
        session_id?: string;
        interaction_type: string;
        summary: string;
        entities_involved?: string[];
        metadata?: Record<string, unknown>;
      }
    ): Promise<{ success: boolean; id: string; path: string }> {
      const interactionId = `int-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
      const timestamp = new Date().toISOString();
      const date = new Date();

      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const dirPath = `_interactions/${year}-${month}-${day}`;
      const notePath = `${dirPath}/${interactionId}.md`;

      const fullDirPath = path.join(vaultPath, dirPath);
      await fs.mkdir(fullDirPath, { recursive: true });

      const frontmatter: Record<string, unknown> = {
        id: interactionId,
        agent_id: params.agent_id,
        interaction_type: params.interaction_type,
        summary: params.summary,
        timestamp,
      };

      if (params.session_id) frontmatter.session_id = params.session_id;
      if (params.entities_involved) frontmatter.entities_involved = params.entities_involved;
      if (params.metadata) frontmatter.metadata = params.metadata;

      const content = `# ${params.interaction_type}: ${params.summary.substring(0, 50)}

${params.summary}
`;

      await writeVaultFile(vaultPath, notePath, content, frontmatter);

      return { success: true, id: interactionId, path: notePath };
    }

    it('should create interaction note in correct directory', async () => {
      const result = await logInteraction(tempVault, {
        agent_id: 'planning-agent',
        interaction_type: 'conversation',
        summary: 'User asked about project timeline',
      });

      expect(result.success).toBe(true);
      expect(result.path).toMatch(/^_interactions\/\d{4}-\d{2}-\d{2}\/.+\.md$/);

      // Verify file exists
      const fullPath = path.join(tempVault, result.path);
      const stat = await fs.stat(fullPath);
      expect(stat.isFile()).toBe(true);
    });

    it('should include agent_id in frontmatter', async () => {
      const result = await logInteraction(tempVault, {
        agent_id: 'research-agent',
        interaction_type: 'tool_use',
        summary: 'Searched for documentation',
      });

      const { frontmatter } = await readVaultFile(tempVault, result.path);
      expect(frontmatter.agent_id).toBe('research-agent');
      expect(frontmatter.interaction_type).toBe('tool_use');
    });

    it('should include session_id when provided', async () => {
      const result = await logInteraction(tempVault, {
        agent_id: 'chat-agent',
        session_id: 'sess-xyz789',
        interaction_type: 'conversation',
        summary: 'Discussed requirements',
      });

      const { frontmatter } = await readVaultFile(tempVault, result.path);
      expect(frontmatter.session_id).toBe('sess-xyz789');
    });

    it('should include entities_involved when provided', async () => {
      const result = await logInteraction(tempVault, {
        agent_id: 'analysis-agent',
        interaction_type: 'decision',
        summary: 'Decided on database schema',
        entities_involved: ['Project Alpha', 'Database Design', 'PostgreSQL'],
      });

      const { frontmatter } = await readVaultFile(tempVault, result.path);
      expect(frontmatter.entities_involved).toEqual(['Project Alpha', 'Database Design', 'PostgreSQL']);
    });

    it('should generate unique IDs for multiple interactions', async () => {
      const results = await Promise.all([
        logInteraction(tempVault, {
          agent_id: 'agent-1',
          interaction_type: 'test',
          summary: 'First interaction',
        }),
        logInteraction(tempVault, {
          agent_id: 'agent-2',
          interaction_type: 'test',
          summary: 'Second interaction',
        }),
      ]);

      expect(results[0].id).not.toBe(results[1].id);
      expect(results[0].path).not.toBe(results[1].path);
    });
  });

  describe('vault_search_interactions (simulated)', () => {
    /**
     * Simulate vault_search_interactions for testing
     */
    async function searchInteractions(
      vaultPath: string,
      filters: {
        agent_id?: string;
        session_id?: string;
        interaction_type?: string;
        entity?: string;
        limit?: number;
      }
    ): Promise<Array<{ id: string; agent_id: string; interaction_type: string; summary: string }>> {
      const date = new Date();
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const dirPath = `_interactions/${year}-${month}-${day}`;
      const fullDirPath = path.join(vaultPath, dirPath);

      const results: Array<{ id: string; agent_id: string; interaction_type: string; summary: string; entities_involved?: string[] }> = [];

      try {
        const files = await fs.readdir(fullDirPath);

        for (const file of files) {
          if (!file.endsWith('.md')) continue;

          const { frontmatter } = await readVaultFile(vaultPath, `${dirPath}/${file}`);

          // Apply filters
          if (filters.agent_id && frontmatter.agent_id !== filters.agent_id) continue;
          if (filters.session_id && frontmatter.session_id !== filters.session_id) continue;
          if (filters.interaction_type && frontmatter.interaction_type !== filters.interaction_type) continue;
          if (filters.entity) {
            const entities = frontmatter.entities_involved as string[] | undefined;
            if (!entities || !entities.some(e => e.toLowerCase().includes(filters.entity!.toLowerCase()))) {
              continue;
            }
          }

          results.push({
            id: frontmatter.id as string,
            agent_id: frontmatter.agent_id as string,
            interaction_type: frontmatter.interaction_type as string,
            summary: frontmatter.summary as string,
            entities_involved: frontmatter.entities_involved as string[] | undefined,
          });
        }
      } catch {
        // Directory doesn't exist
      }

      const limit = filters.limit ?? 20;
      return results.slice(0, limit);
    }

    /**
     * Helper to create test interactions
     */
    async function createTestInteraction(
      vaultPath: string,
      params: {
        agent_id: string;
        session_id?: string;
        interaction_type: string;
        summary: string;
        entities_involved?: string[];
      }
    ): Promise<string> {
      const interactionId = `int-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
      const timestamp = new Date().toISOString();
      const date = new Date();

      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const dirPath = `_interactions/${year}-${month}-${day}`;
      const notePath = `${dirPath}/${interactionId}.md`;

      await fs.mkdir(path.join(vaultPath, dirPath), { recursive: true });

      const frontmatter: Record<string, unknown> = {
        id: interactionId,
        agent_id: params.agent_id,
        interaction_type: params.interaction_type,
        summary: params.summary,
        timestamp,
      };

      if (params.session_id) frontmatter.session_id = params.session_id;
      if (params.entities_involved) frontmatter.entities_involved = params.entities_involved;

      await writeVaultFile(vaultPath, notePath, `# ${params.summary}`, frontmatter);
      return interactionId;
    }

    it('should find all interactions when no filters', async () => {
      await createTestInteraction(tempVault, {
        agent_id: 'agent-1',
        interaction_type: 'conversation',
        summary: 'Test 1',
      });
      await createTestInteraction(tempVault, {
        agent_id: 'agent-2',
        interaction_type: 'decision',
        summary: 'Test 2',
      });

      const results = await searchInteractions(tempVault, {});

      expect(results.length).toBe(2);
    });

    it('should filter by agent_id', async () => {
      await createTestInteraction(tempVault, {
        agent_id: 'agent-1',
        interaction_type: 'conversation',
        summary: 'From agent 1',
      });
      await createTestInteraction(tempVault, {
        agent_id: 'agent-2',
        interaction_type: 'conversation',
        summary: 'From agent 2',
      });

      const results = await searchInteractions(tempVault, { agent_id: 'agent-1' });

      expect(results.length).toBe(1);
      expect(results[0].agent_id).toBe('agent-1');
      expect(results[0].summary).toBe('From agent 1');
    });

    it('should filter by interaction_type', async () => {
      await createTestInteraction(tempVault, {
        agent_id: 'agent-1',
        interaction_type: 'conversation',
        summary: 'Chat',
      });
      await createTestInteraction(tempVault, {
        agent_id: 'agent-1',
        interaction_type: 'decision',
        summary: 'Made a decision',
      });

      const results = await searchInteractions(tempVault, { interaction_type: 'decision' });

      expect(results.length).toBe(1);
      expect(results[0].interaction_type).toBe('decision');
    });

    it('should filter by entity involvement', async () => {
      await createTestInteraction(tempVault, {
        agent_id: 'agent-1',
        interaction_type: 'conversation',
        summary: 'About project',
        entities_involved: ['Project Alpha', 'Design'],
      });
      await createTestInteraction(tempVault, {
        agent_id: 'agent-1',
        interaction_type: 'conversation',
        summary: 'About something else',
        entities_involved: ['Other Entity'],
      });

      const results = await searchInteractions(tempVault, { entity: 'Project Alpha' });

      expect(results.length).toBe(1);
      expect(results[0].summary).toBe('About project');
    });

    it('should respect limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await createTestInteraction(tempVault, {
          agent_id: 'agent-1',
          interaction_type: 'test',
          summary: `Test ${i}`,
        });
      }

      const results = await searchInteractions(tempVault, { limit: 3 });

      expect(results.length).toBe(3);
    });

    it('should return empty array when no matches', async () => {
      await createTestInteraction(tempVault, {
        agent_id: 'agent-1',
        interaction_type: 'conversation',
        summary: 'Test',
      });

      const results = await searchInteractions(tempVault, { agent_id: 'non-existent-agent' });

      expect(results.length).toBe(0);
    });
  });
});

// ========================================
// Integration Tests
// ========================================

describe.sequential('AI Agent Memory Integration', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should support full multi-agent workflow', async () => {
    // Create a note
    await createTestNote(tempVault, 'project.md', `---
title: Project Notes
---
# Project Notes

## Ideas

- Initial brainstorm

## Discussion

- Team meeting notes
`);

    // Agent 1 adds to Ideas section
    await addToSectionWithScoping(
      tempVault,
      'project.md',
      'Ideas',
      'Agent 1 suggests feature X',
      'append',
      'bullet',
      { agent_id: 'ideation-agent', session_id: 'planning-session' }
    );

    // Agent 2 adds to Discussion section
    await addToSectionWithScoping(
      tempVault,
      'project.md',
      'Discussion',
      'Agent 2 analyzes feasibility',
      'append',
      'bullet',
      { agent_id: 'analysis-agent', session_id: 'planning-session' }
    );

    // Verify the content
    const content = await readTestNote(tempVault, 'project.md');
    expect(content).toContain('Agent 1 suggests feature X');
    expect(content).toContain('Agent 2 analyzes feasibility');

    // Verify the last agent is tracked
    const { frontmatter } = await readVaultFile(tempVault, 'project.md');
    expect(frontmatter._agent_id).toBe('analysis-agent');
    expect(frontmatter._session_id).toBe('planning-session');
    expect(frontmatter._modification_count).toBe(2);
  });
});

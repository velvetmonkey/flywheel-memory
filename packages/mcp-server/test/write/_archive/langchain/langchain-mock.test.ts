/**
 * LangChain Integration Mock Tests
 *
 * CI-safe tests that validate LangChain integration patterns
 * without requiring actual LangChain dependencies.
 *
 * These tests verify:
 * - Tool naming conventions for MCP adapters
 * - Tool partitioning logic (read/write separation)
 * - Configuration structure
 */

import { describe, it, expect } from 'vitest';

/**
 * Simulate the tool naming convention used by MultiServerMCPClient.
 * Tools are prefixed with server name + double underscore.
 */
function formatToolName(serverName: string, toolName: string): string {
  return `${serverName}__${toolName}`;
}

/**
 * Extract server name from a formatted tool name.
 */
function extractServerName(formattedToolName: string): string | null {
  const match = formattedToolName.match(/^([^_]+(?:-[^_]+)*)__/);
  return match ? match[1] : null;
}

/**
 * Check if a tool name indicates a read-only tool (Flywheel).
 */
function isReadTool(toolName: string): boolean {
  return toolName.startsWith('flywheel__') && !toolName.startsWith('flywheel-crank__');
}

/**
 * Check if a tool name indicates a write tool (Flywheel-Crank).
 */
function isWriteTool(toolName: string): boolean {
  return toolName.startsWith('flywheel-crank__');
}

describe('LangChain Tool Naming Conventions', () => {
  describe('formatToolName', () => {
    it('should format Flywheel tool names correctly', () => {
      expect(formatToolName('flywheel', 'get_section_content'))
        .toBe('flywheel__get_section_content');

      expect(formatToolName('flywheel', 'get_backlinks'))
        .toBe('flywheel__get_backlinks');

      expect(formatToolName('flywheel', 'search_notes'))
        .toBe('flywheel__search_notes');
    });

    it('should format Flywheel-Crank tool names correctly', () => {
      expect(formatToolName('flywheel-crank', 'vault_add_to_section'))
        .toBe('flywheel-crank__vault_add_to_section');

      expect(formatToolName('flywheel-crank', 'vault_add_task'))
        .toBe('flywheel-crank__vault_add_task');

      expect(formatToolName('flywheel-crank', 'vault_toggle_task'))
        .toBe('flywheel-crank__vault_toggle_task');
    });

    it('should use double underscore as separator', () => {
      const formatted = formatToolName('server-name', 'tool_name');
      expect(formatted).toContain('__');
      expect(formatted.split('__').length).toBe(2);
    });
  });

  describe('extractServerName', () => {
    it('should extract Flywheel server name', () => {
      expect(extractServerName('flywheel__get_section_content'))
        .toBe('flywheel');
    });

    it('should extract Flywheel-Crank server name with hyphen', () => {
      expect(extractServerName('flywheel-crank__vault_add_to_section'))
        .toBe('flywheel-crank');
    });

    it('should return null for invalid format', () => {
      expect(extractServerName('notavalidtoolname')).toBeNull();
      expect(extractServerName('single_underscore')).toBeNull();
    });

    it('should handle tools with underscores in name', () => {
      expect(extractServerName('flywheel__get_section_content'))
        .toBe('flywheel');
      expect(extractServerName('flywheel-crank__vault_add_to_section'))
        .toBe('flywheel-crank');
    });
  });
});

describe('LangChain Tool Partitioning', () => {
  // Simulate tool list from both servers
  const mockFlywheelTools = [
    'flywheel__get_section_content',
    'flywheel__get_note_content',
    'flywheel__get_backlinks',
    'flywheel__search_notes',
    'flywheel__get_note_metadata',
    'flywheel__list_notes',
  ];

  const mockCrankTools = [
    'flywheel-crank__vault_add_to_section',
    'flywheel-crank__vault_add_task',
    'flywheel-crank__vault_toggle_task',
    'flywheel-crank__vault_remove_from_section',
    'flywheel-crank__vault_replace_in_section',
    'flywheel-crank__vault_update_frontmatter',
    'flywheel-crank__vault_create_note',
    'flywheel-crank__vault_delete_note',
  ];

  const allTools = [...mockFlywheelTools, ...mockCrankTools];

  describe('isReadTool', () => {
    it('should identify Flywheel tools as read tools', () => {
      for (const tool of mockFlywheelTools) {
        expect(isReadTool(tool)).toBe(true);
      }
    });

    it('should not identify Crank tools as read tools', () => {
      for (const tool of mockCrankTools) {
        expect(isReadTool(tool)).toBe(false);
      }
    });
  });

  describe('isWriteTool', () => {
    it('should identify Crank tools as write tools', () => {
      for (const tool of mockCrankTools) {
        expect(isWriteTool(tool)).toBe(true);
      }
    });

    it('should not identify Flywheel tools as write tools', () => {
      for (const tool of mockFlywheelTools) {
        expect(isWriteTool(tool)).toBe(false);
      }
    });
  });

  describe('partitioning by filter', () => {
    it('should partition tools into read and write sets', () => {
      const readTools = allTools.filter(isReadTool);
      const writeTools = allTools.filter(isWriteTool);

      expect(readTools.length).toBe(mockFlywheelTools.length);
      expect(writeTools.length).toBe(mockCrankTools.length);
      expect(readTools.length + writeTools.length).toBe(allTools.length);
    });

    it('should have no overlap between read and write tools', () => {
      const readTools = new Set(allTools.filter(isReadTool));
      const writeTools = new Set(allTools.filter(isWriteTool));

      for (const tool of readTools) {
        expect(writeTools.has(tool)).toBe(false);
      }

      for (const tool of writeTools) {
        expect(readTools.has(tool)).toBe(false);
      }
    });
  });

  describe('prefix-based filtering', () => {
    it('should support startsWith filtering for Flywheel', () => {
      const flywheelOnly = allTools.filter(t =>
        t.startsWith('flywheel__')
      );

      expect(flywheelOnly.length).toBe(mockFlywheelTools.length);
      expect(flywheelOnly).toEqual(mockFlywheelTools);
    });

    it('should support startsWith filtering for Crank', () => {
      const crankOnly = allTools.filter(t =>
        t.startsWith('flywheel-crank__')
      );

      expect(crankOnly.length).toBe(mockCrankTools.length);
      expect(crankOnly).toEqual(mockCrankTools);
    });
  });
});

describe('LangChain Configuration Structure', () => {
  describe('MCP server config', () => {
    const validFlywheelConfig = {
      transport: 'stdio' as const,
      command: 'npx',
      args: ['-y', '@velvetmonkey/flywheel-mcp'],
      env: { PROJECT_PATH: '/path/to/vault' },
    };

    const validCrankConfig = {
      transport: 'stdio' as const,
      command: 'npx',
      args: ['-y', '@velvetmonkey/flywheel-crank'],
      env: { PROJECT_PATH: '/path/to/vault' },
    };

    it('should have required transport field', () => {
      expect(validFlywheelConfig.transport).toBe('stdio');
      expect(validCrankConfig.transport).toBe('stdio');
    });

    it('should have required command field', () => {
      expect(validFlywheelConfig.command).toBeDefined();
      expect(validCrankConfig.command).toBeDefined();
    });

    it('should have args array', () => {
      expect(Array.isArray(validFlywheelConfig.args)).toBe(true);
      expect(Array.isArray(validCrankConfig.args)).toBe(true);
    });

    it('should have PROJECT_PATH in env', () => {
      expect(validFlywheelConfig.env.PROJECT_PATH).toBeDefined();
      expect(validCrankConfig.env.PROJECT_PATH).toBeDefined();
    });

    it('should reference correct npm packages', () => {
      expect(validFlywheelConfig.args).toContain('@velvetmonkey/flywheel-mcp');
      expect(validCrankConfig.args).toContain('@velvetmonkey/flywheel-crank');
    });
  });

  describe('multi-server client config', () => {
    interface ServerConfig {
      transport: 'stdio';
      command: string;
      args: string[];
      env: Record<string, string>;
    }

    const multiServerConfig: Record<string, ServerConfig> = {
      flywheel: {
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@velvetmonkey/flywheel-mcp'],
        env: { PROJECT_PATH: '/path/to/vault' },
      },
      'flywheel-crank': {
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@velvetmonkey/flywheel-crank'],
        env: { PROJECT_PATH: '/path/to/vault' },
      },
    };

    it('should have both servers configured', () => {
      expect(Object.keys(multiServerConfig)).toHaveLength(2);
      expect(multiServerConfig['flywheel']).toBeDefined();
      expect(multiServerConfig['flywheel-crank']).toBeDefined();
    });

    it('should use same PROJECT_PATH for both servers', () => {
      expect(multiServerConfig['flywheel'].env.PROJECT_PATH)
        .toBe(multiServerConfig['flywheel-crank'].env.PROJECT_PATH);
    });

    it('should have consistent transport for both servers', () => {
      expect(multiServerConfig['flywheel'].transport)
        .toBe(multiServerConfig['flywheel-crank'].transport);
    });
  });
});

describe('LangChain Agent Patterns', () => {
  describe('reader agent pattern', () => {
    const allTools = [
      'flywheel__get_section_content',
      'flywheel__get_backlinks',
      'flywheel-crank__vault_add_to_section',
      'flywheel-crank__vault_add_task',
    ];

    it('should filter to only read tools for reader agent', () => {
      const readerTools = allTools.filter(t => t.startsWith('flywheel__'));

      expect(readerTools).toHaveLength(2);
      expect(readerTools.every(t => t.startsWith('flywheel__'))).toBe(true);
      expect(readerTools.every(t => !t.startsWith('flywheel-crank__'))).toBe(true);
    });
  });

  describe('writer agent pattern', () => {
    const allTools = [
      'flywheel__get_section_content',
      'flywheel__get_backlinks',
      'flywheel-crank__vault_add_to_section',
      'flywheel-crank__vault_add_task',
    ];

    it('should filter to only write tools for writer agent', () => {
      const writerTools = allTools.filter(t => t.startsWith('flywheel-crank__'));

      expect(writerTools).toHaveLength(2);
      expect(writerTools.every(t => t.startsWith('flywheel-crank__'))).toBe(true);
      expect(writerTools.every(t => !t.startsWith('flywheel__') || t.startsWith('flywheel-crank__'))).toBe(true);
    });
  });

  describe('combined agent pattern', () => {
    it('should allow agent with both read and write tools', () => {
      const allTools = [
        'flywheel__get_section_content',
        'flywheel__get_backlinks',
        'flywheel-crank__vault_add_to_section',
        'flywheel-crank__vault_add_task',
      ];

      // Combined agent has access to all tools
      expect(allTools).toHaveLength(4);

      // But can still differentiate them
      const canRead = allTools.some(t => t.startsWith('flywheel__'));
      const canWrite = allTools.some(t => t.startsWith('flywheel-crank__'));

      expect(canRead).toBe(true);
      expect(canWrite).toBe(true);
    });
  });
});

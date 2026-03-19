/**
 * MV: Multi-Vault Tests
 *
 * Tests for:
 * - VaultRegistry management
 * - parseVaultConfig parsing
 * - VaultContext initialization
 * - Single-vault backward compatibility
 */

import { describe, it, expect } from 'vitest';
import { VaultRegistry, parseVaultConfig, type VaultContext } from '../../../src/vault-registry.js';
import type { VaultIndex } from '../../../src/core/read/types.js';

function createMockContext(name: string, vaultPath: string): VaultContext {
  return {
    name,
    vaultPath,
    stateDb: null,
    vaultIndex: { notes: new Map(), entities: new Map() } as unknown as VaultIndex,
    flywheelConfig: {},
    watcher: null,
  };
}

describe('Multi-Vault', () => {
  describe('VaultRegistry', () => {
    it('stores and retrieves vault contexts', () => {
      const registry = new VaultRegistry('primary');
      const ctx = createMockContext('primary', '/vault/a');
      registry.addContext(ctx);

      expect(registry.getContext('primary')).toBe(ctx);
      expect(registry.getContext()).toBe(ctx); // default = primary
    });

    it('tracks primary vault name', () => {
      const registry = new VaultRegistry('main');
      expect(registry.primaryName).toBe('main');
    });

    it('reports size correctly', () => {
      const registry = new VaultRegistry('a');
      expect(registry.size).toBe(0);

      registry.addContext(createMockContext('a', '/vault/a'));
      expect(registry.size).toBe(1);

      registry.addContext(createMockContext('b', '/vault/b'));
      expect(registry.size).toBe(2);
    });

    it('detects multi-vault mode', () => {
      const registry = new VaultRegistry('a');
      registry.addContext(createMockContext('a', '/vault/a'));
      expect(registry.isMultiVault).toBe(false);

      registry.addContext(createMockContext('b', '/vault/b'));
      expect(registry.isMultiVault).toBe(true);
    });

    it('throws for unknown vault name', () => {
      const registry = new VaultRegistry('a');
      registry.addContext(createMockContext('a', '/vault/a'));

      expect(() => registry.getContext('nonexistent')).toThrow('Vault "nonexistent" not found');
    });

    it('getAllContexts returns all vaults', () => {
      const registry = new VaultRegistry('a');
      const ctxA = createMockContext('a', '/vault/a');
      const ctxB = createMockContext('b', '/vault/b');
      registry.addContext(ctxA);
      registry.addContext(ctxB);

      const all = registry.getAllContexts();
      expect(all).toHaveLength(2);
      expect(all).toContain(ctxA);
      expect(all).toContain(ctxB);
    });

    it('getVaultNames returns all vault names', () => {
      const registry = new VaultRegistry('personal');
      registry.addContext(createMockContext('personal', '/vault/personal'));
      registry.addContext(createMockContext('work', '/vault/work'));

      expect(registry.getVaultNames()).toEqual(['personal', 'work']);
    });
  });

  describe('parseVaultConfig', () => {
    const originalEnv = process.env.FLYWHEEL_VAULTS;

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.FLYWHEEL_VAULTS;
      } else {
        process.env.FLYWHEEL_VAULTS = originalEnv;
      }
    });

    it('returns null when FLYWHEEL_VAULTS is not set', () => {
      delete process.env.FLYWHEEL_VAULTS;
      expect(parseVaultConfig()).toBeNull();
    });

    it('returns null for empty string', () => {
      process.env.FLYWHEEL_VAULTS = '';
      expect(parseVaultConfig()).toBeNull();
    });

    it('parses single vault', () => {
      process.env.FLYWHEEL_VAULTS = 'personal:/home/user/obsidian/Personal';
      const result = parseVaultConfig();
      expect(result).toEqual([
        { name: 'personal', path: '/home/user/obsidian/Personal' },
      ]);
    });

    it('parses multiple vaults', () => {
      process.env.FLYWHEEL_VAULTS = 'personal:/home/user/obsidian/Personal,work:/home/user/obsidian/Work';
      const result = parseVaultConfig();
      expect(result).toEqual([
        { name: 'personal', path: '/home/user/obsidian/Personal' },
        { name: 'work', path: '/home/user/obsidian/Work' },
      ]);
    });

    it('trims whitespace', () => {
      process.env.FLYWHEEL_VAULTS = ' personal:/vault/a , work:/vault/b ';
      const result = parseVaultConfig();
      expect(result).toEqual([
        { name: 'personal', path: '/vault/a' },
        { name: 'work', path: '/vault/b' },
      ]);
    });

    it('skips malformed entries', () => {
      process.env.FLYWHEEL_VAULTS = 'good:/vault/a,bad,also-bad:';
      const result = parseVaultConfig();
      expect(result).toEqual([
        { name: 'good', path: '/vault/a' },
      ]);
    });
  });

  describe('backward compatibility', () => {
    it('single-vault VaultRegistry works with getContext()', () => {
      const registry = new VaultRegistry('default');
      const ctx = createMockContext('default', '/vault/main');
      registry.addContext(ctx);

      // No vault name = primary = "default"
      expect(registry.getContext()).toBe(ctx);
      expect(registry.getContext('default')).toBe(ctx);
      expect(registry.isMultiVault).toBe(false);
    });
  });
});

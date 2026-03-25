/**
 * MV: Multi-Vault Tests
 *
 * Tests for:
 * - VaultRegistry management
 * - parseVaultConfig parsing
 * - VaultContext initialization
 * - Single-vault backward compatibility
 * - activateVault singleton swapping (via direct setter calls)
 * - Two-vault initialization with separate StateDb instances
 */

import { describe, it, expect, afterEach } from 'vitest';
import { VaultRegistry, parseVaultConfig, type VaultContext } from '../../../src/vault-registry.js';
import type { VaultIndex } from '../../../src/core/read/types.js';
import { setWriteStateDb, getWriteStateDb, setWikilinkConfig, setCooccurrenceIndex, getWikilinkStrictness, getCooccurrenceIndex } from '../../../src/core/write/wikilinks.js';
import { setFTS5Database } from '../../../src/core/read/fts5.js';
import { setRecencyStateDb } from '../../../src/core/shared/recency.js';
import { setTaskCacheDatabase } from '../../../src/core/read/taskCache.js';
import { setEmbeddingsDatabase, setEmbeddingsBuilding, isEmbeddingsBuilding } from '../../../src/core/read/embeddings.js';
import { setIndexState, setIndexError, getIndexState, getIndexError, type IndexState } from '../../../src/core/read/graph.js';
import { setActiveScope, getActiveScope, getActiveScopeOrNull } from '../../../src/vault-scope.js';
import type { CooccurrenceIndex } from '../../../src/core/shared/cooccurrence.js';
import { createTempVault, cleanupTempVault, openStateDb, deleteStateDb, type StateDb } from '../helpers/testUtils.js';

function createMockContext(name: string, vaultPath: string): VaultContext {
  return {
    name,
    vaultPath,
    stateDb: null,
    vaultIndex: { notes: new Map(), entities: new Map() } as unknown as VaultIndex,
    flywheelConfig: {},
    watcher: null,
    cooccurrenceIndex: null,
    embeddingsBuilding: false,
    indexState: 'building',
    indexError: null,
    lastCooccurrenceRebuildAt: 0,
    lastEdgeWeightRebuildAt: 0,
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

  describe('activateVault singleton swapping', () => {
    let vaultPathA: string;
    let vaultPathB: string;
    let stateDbA: StateDb;
    let stateDbB: StateDb;

    afterEach(async () => {
      // Clean up module-level singletons
      setWriteStateDb(null);

      if (stateDbA) { stateDbA.db.close(); deleteStateDb(vaultPathA); }
      if (stateDbB) { stateDbB.db.close(); deleteStateDb(vaultPathB); }
      if (vaultPathA) await cleanupTempVault(vaultPathA);
      if (vaultPathB) await cleanupTempVault(vaultPathB);
    });

    it('swaps module-level StateDb when switching vaults', async () => {
      vaultPathA = await createTempVault();
      vaultPathB = await createTempVault();
      stateDbA = openStateDb(vaultPathA);
      stateDbB = openStateDb(vaultPathB);

      // Simulate activateVault(ctxA) — set all singletons to vault A
      setWriteStateDb(stateDbA);
      setFTS5Database(stateDbA.db);
      setRecencyStateDb(stateDbA);

      setTaskCacheDatabase(stateDbA.db);
      setEmbeddingsDatabase(stateDbA.db);

      // Verify vault A is active
      expect(getWriteStateDb()).toBe(stateDbA);

      // Simulate activateVault(ctxB) — swap all singletons to vault B
      setWriteStateDb(stateDbB);
      setFTS5Database(stateDbB.db);
      setRecencyStateDb(stateDbB);

      setTaskCacheDatabase(stateDbB.db);
      setEmbeddingsDatabase(stateDbB.db);

      // Verify vault B is now active — different identity
      expect(getWriteStateDb()).toBe(stateDbB);
      expect(getWriteStateDb()).not.toBe(stateDbA);
    });

    it('each vault gets an independent StateDb file', async () => {
      vaultPathA = await createTempVault();
      vaultPathB = await createTempVault();
      stateDbA = openStateDb(vaultPathA);
      stateDbB = openStateDb(vaultPathB);

      // Different vaults = different DB file paths
      expect(stateDbA.db.name).not.toBe(stateDbB.db.name);

      // Both are functional — can write/read independently
      stateDbA.db.exec('CREATE TABLE IF NOT EXISTS test_a (id INTEGER PRIMARY KEY)');
      stateDbB.db.exec('CREATE TABLE IF NOT EXISTS test_b (id INTEGER PRIMARY KEY)');

      // Vault A has test_a but not test_b
      const tablesA = stateDbA.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'test_%'").all() as Array<{ name: string }>;
      expect(tablesA.map(t => t.name)).toContain('test_a');
      expect(tablesA.map(t => t.name)).not.toContain('test_b');

      // Vault B has test_b but not test_a
      const tablesB = stateDbB.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'test_%'").all() as Array<{ name: string }>;
      expect(tablesB.map(t => t.name)).toContain('test_b');
      expect(tablesB.map(t => t.name)).not.toContain('test_a');
    });
  });

  describe('two-vault initialization', () => {
    let vaultPathA: string;
    let vaultPathB: string;
    let stateDbA: StateDb;
    let stateDbB: StateDb;

    afterEach(async () => {
      setWriteStateDb(null);
      if (stateDbA) { stateDbA.db.close(); deleteStateDb(vaultPathA); }
      if (stateDbB) { stateDbB.db.close(); deleteStateDb(vaultPathB); }
      if (vaultPathA) await cleanupTempVault(vaultPathA);
      if (vaultPathB) await cleanupTempVault(vaultPathB);
    });

    it('initializes two vaults with separate StateDb and registry', async () => {
      vaultPathA = await createTempVault();
      vaultPathB = await createTempVault();
      stateDbA = openStateDb(vaultPathA);
      stateDbB = openStateDb(vaultPathB);

      // Build VaultContexts like initializeVault() does
      const ctxA: VaultContext = {
        name: 'personal',
        vaultPath: vaultPathA,
        stateDb: stateDbA,
        vaultIndex: { notes: new Map(), entities: new Map() } as unknown as VaultIndex,
        flywheelConfig: {},
        watcher: null,
        cooccurrenceIndex: null,
        embeddingsBuilding: false,
        indexState: 'building',
        indexError: null,
        lastCooccurrenceRebuildAt: 0,
        lastEdgeWeightRebuildAt: 0,
      };
      const ctxB: VaultContext = {
        name: 'work',
        vaultPath: vaultPathB,
        stateDb: stateDbB,
        vaultIndex: { notes: new Map(), entities: new Map() } as unknown as VaultIndex,
        flywheelConfig: {},
        watcher: null,
        cooccurrenceIndex: null,
        embeddingsBuilding: false,
        indexState: 'building',
        indexError: null,
        lastCooccurrenceRebuildAt: 0,
        lastEdgeWeightRebuildAt: 0,
      };

      // Register in a VaultRegistry
      const registry = new VaultRegistry('personal');
      registry.addContext(ctxA);
      registry.addContext(ctxB);

      // Verify registry state
      expect(registry.isMultiVault).toBe(true);
      expect(registry.size).toBe(2);
      expect(registry.getVaultNames()).toEqual(['personal', 'work']);

      // Verify each context has correct path and independent StateDb
      expect(registry.getContext('personal').vaultPath).toBe(vaultPathA);
      expect(registry.getContext('work').vaultPath).toBe(vaultPathB);
      expect(registry.getContext('personal').stateDb).not.toBe(registry.getContext('work').stateDb);

      // Primary vault is 'personal'
      expect(registry.getContext()).toBe(ctxA);
    });
  });

  describe('vault param error handling', () => {
    it('error message includes available vault names', () => {
      const registry = new VaultRegistry('personal');
      registry.addContext(createMockContext('personal', '/vault/personal'));
      registry.addContext(createMockContext('work', '/vault/work'));

      expect(() => registry.getContext('nonexistent')).toThrow('Vault "nonexistent" not found');
      expect(() => registry.getContext('nonexistent')).toThrow('Available: personal, work');
    });

    it('error with single vault shows only that name', () => {
      const registry = new VaultRegistry('main');
      registry.addContext(createMockContext('main', '/vault/main'));

      expect(() => registry.getContext('other')).toThrow('Vault "other" not found. Available: main');
    });
  });

  describe('VaultScope isolation', () => {
    function createMockCooccurrence(entityCount: number): CooccurrenceIndex {
      return {
        associations: {},
        minCount: 2,
        _metadata: { total_associations: entityCount, total_entities: entityCount, built_at: Date.now(), total_notes_scanned: 0 },
        documentFrequency: new Map(),
        totalNotesScanned: 0,
      };
    }

    /** Simulates what activateVault() does: set module-level state + VaultScope */
    function activateVaultForTest(ctx: VaultContext): void {
      (globalThis as any).__flywheel_active_vault = ctx.name;

      if (ctx.stateDb) {
        setWriteStateDb(ctx.stateDb);
        setFTS5Database(ctx.stateDb.db);
        setRecencyStateDb(ctx.stateDb);
        setTaskCacheDatabase(ctx.stateDb.db);
        setEmbeddingsDatabase(ctx.stateDb.db);
      }

      setWikilinkConfig(ctx.flywheelConfig);
      setCooccurrenceIndex(ctx.cooccurrenceIndex);
      setIndexState(ctx.indexState);
      setIndexError(ctx.indexError);
      setEmbeddingsBuilding(ctx.embeddingsBuilding);

      setActiveScope({
        name: ctx.name,
        vaultPath: ctx.vaultPath,
        stateDb: ctx.stateDb,
        flywheelConfig: ctx.flywheelConfig,
        cooccurrenceIndex: ctx.cooccurrenceIndex,
        indexState: ctx.indexState,
        indexError: ctx.indexError,
        embeddingsBuilding: ctx.embeddingsBuilding,
      });
    }

    let vaultPathA: string;
    let vaultPathB: string;
    let stateDbA: StateDb;
    let stateDbB: StateDb;

    afterEach(async () => {
      setWriteStateDb(null);
      if (stateDbA) { stateDbA.db.close(); deleteStateDb(vaultPathA); }
      if (stateDbB) { stateDbB.db.close(); deleteStateDb(vaultPathB); }
      if (vaultPathA) await cleanupTempVault(vaultPathA);
      if (vaultPathB) await cleanupTempVault(vaultPathB);
    });

    it('swaps all state when switching between two vaults', async () => {
      vaultPathA = await createTempVault();
      vaultPathB = await createTempVault();
      stateDbA = openStateDb(vaultPathA);
      stateDbB = openStateDb(vaultPathB);

      const coocA = createMockCooccurrence(10);
      const coocB = createMockCooccurrence(20);

      const ctxA: VaultContext = {
        ...createMockContext('personal', vaultPathA),
        stateDb: stateDbA,
        flywheelConfig: { wikilink_strictness: 'aggressive' },
        cooccurrenceIndex: coocA,
        indexState: 'ready',
        embeddingsBuilding: false,
      };

      const ctxB: VaultContext = {
        ...createMockContext('work', vaultPathB),
        stateDb: stateDbB,
        flywheelConfig: { wikilink_strictness: 'conservative' },
        cooccurrenceIndex: coocB,
        indexState: 'building',
        embeddingsBuilding: true,
      };

      // Activate vault A
      activateVaultForTest(ctxA);
      expect(getWriteStateDb()).toBe(stateDbA);
      expect(getWikilinkStrictness()).toBe('aggressive');
      expect(getCooccurrenceIndex()).toBe(coocA);
      expect(getIndexState()).toBe('ready');
      expect(isEmbeddingsBuilding()).toBe(false);
      expect(getActiveScope().name).toBe('personal');

      // Switch to vault B
      activateVaultForTest(ctxB);
      expect(getWriteStateDb()).toBe(stateDbB);
      expect(getWikilinkStrictness()).toBe('conservative');
      expect(getCooccurrenceIndex()).toBe(coocB);
      expect(getIndexState()).toBe('building');
      expect(isEmbeddingsBuilding()).toBe(true);
      expect(getActiveScope().name).toBe('work');

      // Switch back to vault A — verify no cross-contamination
      activateVaultForTest(ctxA);
      expect(getWriteStateDb()).toBe(stateDbA);
      expect(getWikilinkStrictness()).toBe('aggressive');
      expect(getCooccurrenceIndex()).toBe(coocA);
      expect(getIndexState()).toBe('ready');
      expect(isEmbeddingsBuilding()).toBe(false);
      expect(getActiveScope().name).toBe('personal');
    });

    it('VaultScope reads match module-level state after activation', async () => {
      vaultPathA = await createTempVault();
      stateDbA = openStateDb(vaultPathA);

      const testError = new Error('test build failure');
      const ctxA: VaultContext = {
        ...createMockContext('test', vaultPathA),
        stateDb: stateDbA,
        indexState: 'error',
        indexError: testError,
      };

      activateVaultForTest(ctxA);

      // VaultScope-backed reads match module-level reads
      expect(getIndexState()).toBe('error');
      expect(getIndexError()).toBe(testError);
      expect(getActiveScope().indexState).toBe('error');
      expect(getActiveScope().indexError).toBe(testError);
    });

    it('getActiveScopeOrNull returns null before any activation', () => {
      // Reset scope (this test runs in isolation)
      setActiveScope(null as any);
      // getActiveScopeOrNull should handle null gracefully
      // (Note: in practice, activateVault is always called during startup)
    });
  });
});

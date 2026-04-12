/**
 * T9: HTTP McpServer Pool Tests
 *
 * Tests for pooling semantics:
 * - Reconnect reuse works (connect → close → reconnect → tools/list)
 * - Tool metadata survives reconnect
 * - No concurrent sharing (pool size 1 → second acquire creates fresh)
 * - Error path discards instance (not returned to pool)
 * - Pool invalidation after registry growth
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { connectMcpTestClient } from '../../helpers/mcpClient.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Minimal transport for testing connect/close lifecycle. Calls onclose on close(). */
function createFakeTransport(): Transport {
  const t: any = {
    start: async () => {},
    close: async () => { t.onclose?.(); },
    send: async () => {},
    onclose: undefined,
    onerror: undefined,
    onmessage: undefined,
    sessionId: undefined,
  };
  return t as Transport;
}

/** Register a few tools on a server to simulate real usage. */
function registerTestTools(server: McpServer): string[] {
  const names = ['tool_alpha', 'tool_beta', 'tool_gamma'];
  for (const name of names) {
    server.tool(name, `Test tool ${name}`, {}, async () => ({
      content: [{ type: 'text' as const, text: `${name} result` }],
    }));
  }
  return names;
}

async function getRegisteredToolNames(server: McpServer): Promise<string[]> {
  const client = await connectMcpTestClient(server);
  const names = (await client.listTools()).tools.map((tool) => tool.name);
  await client.close();
  return names;
}

// ─── Pool Implementation (mirrors index.ts, isolated for testing) ───────────

function createPool(poolSize: number, factory: () => McpServer) {
  const pool: McpServer[] = [];
  let createCount = 0;
  let reuseCount = 0;
  let discardCount = 0;

  return {
    pool,
    acquire(): McpServer {
      const pooled = pool.pop();
      if (pooled) {
        reuseCount++;
        return pooled;
      }
      createCount++;
      return factory();
    },
    release(s: McpServer): void {
      if (pool.length < poolSize) {
        pool.push(s);
      }
    },
    discard(_s: McpServer): void {
      discardCount++;
    },
    invalidate(): void {
      pool.length = 0;
    },
    get stats() {
      return { createCount, reuseCount, discardCount, available: pool.length };
    },
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('T9: HTTP McpServer Pool', () => {
  describe('reconnect reuse', () => {
    it('server works after close + reconnect with new transport', async () => {
      const server = new McpServer({ name: 'test', version: '0.0.0' });
      const expectedNames = registerTestTools(server);

      const client1 = await connectMcpTestClient(server);
      await client1.close();

      const names = await getRegisteredToolNames(server);
      for (const name of expectedNames) {
        expect(names).toContain(name);
      }
    });

    it('tool metadata survives reconnect — same count and names', async () => {
      const server = new McpServer({ name: 'test', version: '0.0.0' });
      const expectedNames = registerTestTools(server);

      const client = await connectMcpTestClient(server);
      await client.close();

      const after = await getRegisteredToolNames(server);

      expect(after.length).toBe(expectedNames.length);
      for (const name of expectedNames) {
        expect(after).toContain(name);
      }
    });
  });

  describe('pool acquire/release', () => {
    it('second acquire from pool size 1 creates fresh instance', () => {
      const pool = createPool(1, () => {
        const s = new McpServer({ name: 'test', version: '0.0.0' });
        registerTestTools(s);
        return s;
      });

      const server1 = pool.acquire();
      // Pool is now empty (server1 was created fresh, not from pool)
      const server2 = pool.acquire();
      // server2 is also created fresh — different instance
      expect(server1).not.toBe(server2);
      expect(pool.stats.createCount).toBe(2);
      expect(pool.stats.reuseCount).toBe(0);
    });

    it('released server is reused on next acquire', async () => {
      const pool = createPool(2, () => {
        const s = new McpServer({ name: 'test', version: '0.0.0' });
        registerTestTools(s);
        return s;
      });

      const server1 = pool.acquire();
      expect(pool.stats.createCount).toBe(1);

      // Simulate clean request lifecycle
      const transport = createFakeTransport();
      await server1.connect(transport);
      await server1.close();
      pool.release(server1);

      expect(pool.stats.available).toBe(1);

      const server2 = pool.acquire();
      expect(server2).toBe(server1); // Same instance reused
      expect(pool.stats.reuseCount).toBe(1);
      expect(pool.stats.createCount).toBe(1); // No new creation
    });

    it('pool does not exceed max size', () => {
      const pool = createPool(2, () => new McpServer({ name: 'test', version: '0.0.0' }));

      const servers = [pool.acquire(), pool.acquire(), pool.acquire()];
      expect(pool.stats.createCount).toBe(3);

      // Release all 3 — only 2 should fit
      for (const s of servers) pool.release(s);
      expect(pool.stats.available).toBe(2);
    });
  });

  describe('error path discards', () => {
    it('discarded server is not returned to pool', () => {
      const pool = createPool(4, () => new McpServer({ name: 'test', version: '0.0.0' }));

      const server = pool.acquire();
      pool.discard(server);

      expect(pool.stats.discardCount).toBe(1);
      expect(pool.stats.available).toBe(0);
    });

    it('simulated error uses discard path', async () => {
      const pool = createPool(4, () => {
        const s = new McpServer({ name: 'test', version: '0.0.0' });
        registerTestTools(s);
        return s;
      });

      const server = pool.acquire();
      const transport = createFakeTransport();
      let cleanExit = false;
      try {
        await server.connect(transport);
        // Simulate an error during handleRequest
        throw new Error('simulated request failure');
      } catch {
        // Error caught
      } finally {
        try { await server.close(); } catch { /* best-effort */ }
        if (cleanExit) {
          pool.release(server);
        } else {
          pool.discard(server);
        }
      }

      expect(pool.stats.discardCount).toBe(1);
      expect(pool.stats.available).toBe(0);

      // Next acquire should create fresh
      const server2 = pool.acquire();
      expect(server2).not.toBe(server);
      expect(pool.stats.createCount).toBe(2);
    });
  });

  describe('pool invalidation', () => {
    it('invalidate clears all pooled servers', async () => {
      const pool = createPool(4, () => {
        const s = new McpServer({ name: 'test', version: '0.0.0' });
        registerTestTools(s);
        return s;
      });

      // Acquire 3 servers, close them, then release all to fill pool
      const servers: McpServer[] = [];
      for (let i = 0; i < 3; i++) {
        servers.push(pool.acquire());
      }
      // Connect and close each so they can be reconnected later
      for (const s of servers) {
        const t = createFakeTransport();
        await s.connect(t);
        await s.close();
      }
      // Release all into pool
      for (const s of servers) {
        pool.release(s);
      }
      expect(pool.stats.available).toBe(3);

      // Invalidate (simulates secondary vault registration)
      pool.invalidate();
      expect(pool.stats.available).toBe(0);

      // Next acquire creates fresh
      const fresh = pool.acquire();
      expect(servers).not.toContain(fresh);
    });

    it('invalidation does not affect future acquire/release', async () => {
      const pool = createPool(2, () => {
        const s = new McpServer({ name: 'test', version: '0.0.0' });
        registerTestTools(s);
        return s;
      });

      pool.invalidate(); // No-op on empty pool

      const server = pool.acquire();
      const transport = createFakeTransport();
      await server.connect(transport);
      await server.close();
      pool.release(server);

      expect(pool.stats.available).toBe(1);

      const reused = pool.acquire();
      expect(reused).toBe(server);
      expect(pool.stats.reuseCount).toBe(1);
    });
  });

  describe('SDK lifecycle safety', () => {
    it('connect throws if called without close', async () => {
      const server = new McpServer({ name: 'test', version: '0.0.0' });
      registerTestTools(server);

      const transport1 = createFakeTransport();
      await server.connect(transport1);

      // Second connect without close should throw
      const transport2 = createFakeTransport();
      await expect(server.connect(transport2)).rejects.toThrow(/already connected/i);

      await server.close();
    });

    it('multiple connect/close cycles work', async () => {
      const server = new McpServer({ name: 'test', version: '0.0.0' });
      registerTestTools(server);

      for (let i = 0; i < 5; i++) {
        const names = await getRegisteredToolNames(server);
        expect(names.length).toBe(3);
      }
    });
  });
});

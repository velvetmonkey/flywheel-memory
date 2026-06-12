/**
 * Transports (arch-review S10 — extracted verbatim from index.ts).
 *
 * Phase 2 of main(): stdio connect + hand-rolled express HTTP app with the
 * pooled-server POST /mcp handler and GET /health route, plus the optional
 * watchdog self-ping. The stdio McpServer itself is constructed at IMPORT
 * TIME in index.ts (observable timing) and passed in here.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { performance } from 'node:perf_hooks';
import { serverLog } from './../core/shared/serverLog.js';
import { runWithCaller } from './../caller-scope.js';
import {
  pkg,
  vaultPath,
  vaultRegistry,
  serverReady,
  shutdownRequested,
  setHttpListener,
  setWatchdogTimer,
} from './state.js';
import {
  HTTP_POOL_SIZE,
  httpServerPool,
  httpRequestCount,
  httpServerCreateCount,
  httpServerReuseCount,
  httpServerDiscardCount,
  incrementHttpRequestCount,
  acquireHttpServer,
  releaseHttpServer,
  discardHttpServer,
} from './serverFactory.js';

/**
 * ── Phase 2: Connect transports BEFORE heavy work ──
 * Tools use lazy getters — they'll return "StateDb not available" until boot
 * completes, but the MCP handshake completes in <1s instead of 60s+.
 *
 * Returns the resolved transport mode (consumed by startWatchdog).
 */
export async function connectTransports(server: McpServer, startTime: number): Promise<string> {
  const transportMode = (process.env.FLYWHEEL_TRANSPORT ?? 'stdio').toLowerCase();

  if (transportMode === 'stdio' || transportMode === 'both') {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    serverLog('server', `MCP server connected (stdio) in ${Date.now() - startTime}ms`);
  }

  if (transportMode === 'http' || transportMode === 'both') {
    const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');

    const httpPort = parseInt(process.env.FLYWHEEL_HTTP_PORT ?? '3111', 10);
    if (!Number.isFinite(httpPort) || httpPort < 1 || httpPort > 65535) {
      console.error(`[flywheel] Fatal: invalid FLYWHEEL_HTTP_PORT: ${process.env.FLYWHEEL_HTTP_PORT} (must be 1-65535)`);
      process.exit(1);
    }
    const httpHost = process.env.FLYWHEEL_HTTP_HOST ?? '127.0.0.1';

    // Hand-rolled replica of the SDK's createMcpExpressApp, because its
    // express.json() uses the 100kb default — large engine plan re-renders
    // and migrated audit batches blew past it (PayloadTooLargeError, first
    // observed on the v2.12.18 cutover). Same DNS-rebinding protection.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { default: express } = (await import('express' as string)) as { default: any };
    const { localhostHostValidation } = await import(
      '@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js'
    );
    const app = express();
    app.use(express.json({ limit: '16mb' }));
    if (['127.0.0.1', 'localhost', '::1'].includes(httpHost)) {
      app.use(localhostHostValidation());
    }

    // HTTP — pooled McpServer + per-request StreamableHTTPServerTransport
    app.post('/mcp', async (req: any, res: any) => {
      const t0 = performance.now();
      const httpServer = acquireHttpServer();
      const acquireMs = performance.now() - t0;

      const httpTransport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      // Caller attribution: a consumer (the Mega Monkey engine) tags each
      // request with its conversation scope so the observer side-channel can
      // map observation → caller. Bound to the async context for the whole
      // request via runWithCaller, read by the observer wrapper at emit time.
      const callerHeader = req.headers['x-flywheel-caller'];
      const callerId = Array.isArray(callerHeader) ? callerHeader[0] : callerHeader;
      let cleanExit = false;
      try {
        await httpServer.connect(httpTransport);
        const connectMs = performance.now() - t0;
        incrementHttpRequestCount();
        await runWithCaller(callerId, () => httpTransport.handleRequest(req, res, req.body));
        cleanExit = true;
        const totalMs = performance.now() - t0;
        if (totalMs > 25 || acquireMs > 5 || (connectMs - acquireMs) > 5) {
          serverLog('http', `request: acquire=${acquireMs.toFixed(1)}ms connect=${(connectMs - acquireMs).toFixed(1)}ms total=${totalMs.toFixed(1)}ms`);
        }
      } catch (err) {
        serverLog('http', `request error: ${err instanceof Error ? err.message : err}`, 'error');
      } finally {
        try { await httpTransport.close(); } catch { /* best-effort */ }
        try { await httpServer.close(); } catch { /* best-effort */ }
        if (cleanExit) {
          releaseHttpServer(httpServer);
        } else {
          discardHttpServer(httpServer);
        }
      }
    });

    app.get('/health', (_req: any, res: any) => {
      const mem = process.memoryUsage();
      const health: Record<string, unknown> = {
        status: 'ok',
        version: pkg.version,
        // Semantic capability surface — clients (mega-monkey engine) gate
        // mutating operations on these, not on tool names or versions.
        capabilities: [
          'cas_writes',                 // note create expectedHash + WRITE_CONFLICT/FILE_EXISTS codes
          'raw_read',                   // read action=raw {rawContent, content_hash}
          'thread_markers',             // 🧵#thr-/🧵#handle wikilink marker pass
          'proactive_exclude_folders',  // watcher proactive linking folder exclusion
        ],
        vault: vaultPath,
        ready: serverReady,
        uptime_s: Math.round(process.uptime()),
        memory: {
          rss_mb: Math.round(mem.rss / 1048576),
          heap_used_mb: Math.round(mem.heapUsed / 1048576),
          heap_total_mb: Math.round(mem.heapTotal / 1048576),
          external_mb: Math.round(mem.external / 1048576),
        },
        http: {
          requests: httpRequestCount,
          pool_available: httpServerPool.length,
          pool_max: HTTP_POOL_SIZE,
          servers_created: httpServerCreateCount,
          servers_reused: httpServerReuseCount,
          servers_discarded: httpServerDiscardCount,
        },
      };
      if (vaultRegistry?.isMultiVault) {
        health.vaults = vaultRegistry.getVaultNames();
      }
      res.json(health);
    });

    setHttpListener(app.listen(httpPort, httpHost, () => {
      serverLog('server', `HTTP transport on ${httpHost}:${httpPort}`);
    }));
  }

  return transportMode;
}

/** ── Optional watchdog self-ping ── */
export async function startWatchdog(transportMode: string): Promise<void> {
  const watchdogInterval = parseInt(process.env.FLYWHEEL_WATCHDOG_INTERVAL ?? '0', 10);
  if (watchdogInterval > 0 && (transportMode === 'http' || transportMode === 'both')) {
    let consecutiveFailures = 0;
    const httpPort = parseInt(process.env.FLYWHEEL_HTTP_PORT ?? '3111', 10);
    const http = await import('http');
    const watchdogTimer = setInterval(() => {
      if (shutdownRequested) return;
      const req = http.get(`http://127.0.0.1:${httpPort}/health`, { timeout: 5000 }, (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => { body += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            if (res.statusCode === 200 && parsed.status === 'ok' && parsed.ready === true) {
              consecutiveFailures = 0;
            } else {
              consecutiveFailures++;
              serverLog('watchdog', `Health check degraded (${consecutiveFailures}/3): status=${parsed.status} ready=${parsed.ready}`, 'warn');
            }
          } catch {
            consecutiveFailures++;
            serverLog('watchdog', `Health check parse error (${consecutiveFailures}/3)`, 'warn');
          }
          if (consecutiveFailures >= 3) {
            serverLog('watchdog', `3 consecutive health check failures — exiting for systemd restart`, 'error');
            process.exit(1);
          }
        });
      });
      req.on('error', () => {
        consecutiveFailures++;
        serverLog('watchdog', `Health check failed (${consecutiveFailures}/3): request error`, 'warn');
        if (consecutiveFailures >= 3) {
          serverLog('watchdog', `3 consecutive health check failures — exiting for systemd restart`, 'error');
          process.exit(1);
        }
      });
      req.on('timeout', () => {
        req.destroy();
        consecutiveFailures++;
        serverLog('watchdog', `Health check timeout (${consecutiveFailures}/3)`, 'warn');
        if (consecutiveFailures >= 3) {
          serverLog('watchdog', `3 consecutive health check failures — exiting for systemd restart`, 'error');
          process.exit(1);
        }
      });
    }, watchdogInterval);
    setWatchdogTimer(watchdogTimer);
    watchdogTimer.unref();
    serverLog('watchdog', `Self-ping watchdog started (interval=${watchdogInterval}ms)`);
  }
}

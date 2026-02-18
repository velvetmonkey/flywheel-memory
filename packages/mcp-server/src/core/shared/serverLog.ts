/**
 * Server Activity Log — in-memory ring buffer for startup/runtime diagnostics
 *
 * Appends to buffer AND writes to console.error so existing stderr logging
 * continues to work. The buffer is queryable via the `server_log` MCP tool.
 */

export type LogLevel = 'info' | 'warn' | 'error';

export type LogComponent =
  | 'server' | 'index' | 'fts5' | 'semantic'
  | 'tasks' | 'watcher' | 'statedb' | 'config';

export interface LogEntry {
  ts: number;
  component: LogComponent;
  message: string;
  level: LogLevel;
}

const MAX_ENTRIES = 200;
const buffer: LogEntry[] = [];
const serverStartTs = Date.now();

/**
 * Log a message to the ring buffer and stderr.
 */
export function serverLog(component: LogComponent, message: string, level: LogLevel = 'info'): void {
  const entry: LogEntry = {
    ts: Date.now(),
    component,
    message,
    level,
  };

  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) {
    buffer.shift();
  }

  // Mirror to stderr (preserving existing behaviour)
  const prefix = level === 'error' ? '[Memory] ERROR' : level === 'warn' ? '[Memory] WARN' : '[Memory]';
  console.error(`${prefix} [${component}] ${message}`);
}

/**
 * Query the log buffer with optional filters.
 */
export function getServerLog(options: {
  since?: number;
  component?: string;
  limit?: number;
} = {}): { entries: LogEntry[]; server_uptime_ms: number } {
  const { since, component, limit = 100 } = options;

  let entries = buffer;

  if (since) {
    entries = entries.filter(e => e.ts > since);
  }

  if (component) {
    entries = entries.filter(e => e.component === component);
  }

  // Return most recent entries (tail of buffer)
  if (entries.length > limit) {
    entries = entries.slice(-limit);
  }

  return {
    entries,
    server_uptime_ms: Date.now() - serverStartTs,
  };
}

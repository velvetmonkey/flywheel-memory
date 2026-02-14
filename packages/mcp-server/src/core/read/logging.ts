/**
 * Unified logging for Flywheel
 *
 * Provides operation logging with session correlation, metrics aggregation,
 * and privacy controls. Integrates with vault-core's OperationLogger.
 *
 * Usage in tools:
 *   import { logOperation } from '../core/logging.js';
 *
 *   // Log a successful operation
 *   await logOperation('get_backlinks', result.success, Date.now() - startTime, {
 *     noteCount: result.notes.length,
 *   });
 */

import {
  OperationLogger,
  createLoggerFromConfig,
  generateSessionId,
  setSessionId,
} from '@velvetmonkey/vault-core';

/**
 * Global logger instance (initialized on server start)
 */
let logger: OperationLogger | null = null;

/**
 * Initialize the logger from vault config
 * Called once during server startup
 */
export async function initializeLogger(vaultPath: string): Promise<void> {
  try {
    // Generate a new session ID for this server instance
    const sessionId = generateSessionId();
    setSessionId(sessionId);

    // Create logger from vault config (or use defaults)
    logger = await createLoggerFromConfig(vaultPath, 'flywheel');
  } catch (error) {
    console.error(`[Flywheel] Failed to initialize logger: ${error}`);
    // Continue without logging - it's optional
    logger = null;
  }
}

/**
 * Get the logger instance (may be null if not initialized or disabled)
 */
export function getLogger(): OperationLogger | null {
  return logger;
}

/**
 * Log an operation with the unified logger
 *
 * @param tool - Tool name (e.g., 'get_backlinks')
 * @param success - Whether the operation succeeded
 * @param durationMs - Duration in milliseconds
 * @param details - Optional additional details
 */
export async function logOperation(
  tool: string,
  success: boolean,
  durationMs: number,
  details?: Record<string, unknown>
): Promise<void> {
  if (!logger || !logger.enabled) {
    return;
  }

  try {
    await logger.log({
      tool,
      vault: '',  // Will be anonymized by logger
      duration_ms: durationMs,
      success,
      ...details,
    });
  } catch (error) {
    // Don't let logging errors affect tool operations
    console.error(`[Flywheel] Logging error: ${error}`);
  }
}

/**
 * Wrap an async operation with automatic logging
 *
 * @param tool - Tool name
 * @param operation - Async operation to wrap
 * @param getDetails - Optional function to extract details from result
 */
export async function wrapWithLogging<T>(
  tool: string,
  operation: () => Promise<T>,
  getDetails?: (result: T) => Record<string, unknown>
): Promise<T> {
  if (!logger || !logger.enabled) {
    return operation();
  }

  return logger.wrap(tool, operation, getDetails);
}

/**
 * Flush any pending log entries
 * Called during graceful shutdown
 */
export async function flushLogs(): Promise<void> {
  if (logger) {
    await logger.flush();
  }
}

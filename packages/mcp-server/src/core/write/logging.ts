/**
 * Unified logging for Flywheel Memory
 *
 * Provides operation logging with session correlation, metrics aggregation,
 * and privacy controls. Integrates with vault-core's OperationLogger.
 */

import {
  OperationLogger,
  createLoggerFromConfig,
  generateSessionId,
  setSessionId,
} from '@velvetmonkey/vault-core';
import { serverLog } from '../shared/serverLog.js';

let logger: OperationLogger | null = null;

export async function initializeLogger(vaultPath: string): Promise<void> {
  try {
    const sessionId = generateSessionId();
    setSessionId(sessionId);
    logger = await createLoggerFromConfig(vaultPath, 'write');
  } catch (error) {
    serverLog('server', `Failed to initialize logger: ${error}`, 'error');
    logger = null;
  }
}

export function getLogger(): OperationLogger | null {
  return logger;
}

export async function logOperation(
  tool: string,
  success: boolean,
  durationMs: number,
  details?: Record<string, unknown>
): Promise<void> {
  if (!logger || !logger.enabled) return;
  try {
    await logger.log({ tool, vault: '', duration_ms: durationMs, success, ...details });
  } catch (error) {
    serverLog('server', `Logging error: ${error}`, 'error');
  }
}

export async function flushLogs(): Promise<void> {
  if (logger) await logger.flush();
}

/**
 * Calibration Export Tool — flywheel_calibration_export
 *
 * Retired (T43) — registration removed from MCP surface.
 * Core logic preserved in core/read/calibrationExport.ts.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VaultIndex } from '../../core/read/types.js';
import type { StateDb } from '@velvetmonkey/vault-core';
import type { FlywheelConfig } from '../../core/read/config.js';

// Registration removed (T43). Core logic: core/read/calibrationExport.ts
export function registerCalibrationExportTools(
  _server: McpServer,
  _getIndex: () => VaultIndex,
  _getStateDb: () => StateDb | null,
  _getConfig: () => FlywheelConfig,
): void {}

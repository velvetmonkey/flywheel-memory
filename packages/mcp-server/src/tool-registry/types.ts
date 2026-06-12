import type { RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolCategory, ToolTier, ToolTierOverride } from '../config.js';
import type { VaultContext } from '../vault-types.js';
import type { VaultScope } from '../vault-scope.js';

export interface VaultActivationCallbacks {
  activateVault: (ctx: VaultContext) => void;
  buildVaultScope: (ctx: VaultContext) => VaultScope;
}

export type ToolTierMode = 'off' | 'tiered';

/**
 * Controller surface returned by applyToolGating (tool-registry.ts). Lives
 * here so tools/read/discovery.ts can type against it without importing
 * tool-registry.ts (arch-review S1 cycle collapse).
 */
export interface ToolTierController {
  readonly mode: ToolTierMode;
  readonly registered: number;
  readonly skipped: number;
  readonly activeCategories: Set<ToolCategory>;
  getOverride(): ToolTierOverride;
  finalizeRegistration(): void;
  activateCategory(category: ToolCategory, tier?: ToolTier): void;
  enableTierCategory(category: ToolCategory): void;
  enableAllTiers(): void;
  setOverride(override: ToolTierOverride): void;
  getActivatedCategoryTiers(): ReadonlyMap<ToolCategory, ToolTier>;
  getRegisteredTools(): ReadonlyMap<string, RegisteredTool>;
}

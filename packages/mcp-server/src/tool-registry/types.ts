import type { VaultContext } from '../vault-registry.js';
import type { VaultScope } from '../vault-scope.js';

export interface VaultActivationCallbacks {
  activateVault: (ctx: VaultContext) => void;
  buildVaultScope: (ctx: VaultContext) => VaultScope;
}

export type ToolTierMode = 'off' | 'tiered';

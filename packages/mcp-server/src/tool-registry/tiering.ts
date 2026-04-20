import {
  ALL_CATEGORIES,
  TOOL_CATEGORY,
  TOOL_TIER,
  type ToolCategory,
  type ToolTier,
  type ToolTierOverride,
} from '../config.js';
import type { ToolTierMode } from './types.js';

export interface TierVisibilityState {
  categories: Set<ToolCategory>;
  tierMode: ToolTierMode;
  tierOverride: ToolTierOverride;
  activatedCategoryTiers: ReadonlyMap<ToolCategory, ToolTier>;
}

export function shouldEnableTieredTool(
  toolName: string,
  state: TierVisibilityState,
): boolean {
  const tier = TOOL_TIER[toolName];
  const category = TOOL_CATEGORY[toolName];
  if (!tier || !category) return true;
  if (!state.categories.has(category)) return false;
  if (state.tierMode === 'off') return true;
  if (
    state.categories.size === ALL_CATEGORIES.length &&
    ALL_CATEGORIES.every((value) => state.categories.has(value))
  ) {
    return true;
  }
  if (state.tierOverride === 'full') return true;
  if (tier === 1) return true;
  if (state.tierOverride === 'minimal') return false;
  const activatedTier = state.activatedCategoryTiers.get(category) ?? 0;
  return activatedTier >= tier;
}

export function getDirectCallPromotion(
  toolName: string,
  categories: Set<ToolCategory>,
  tierMode: ToolTierMode,
): { category: ToolCategory; tier: ToolTier } | null {
  if (tierMode !== 'tiered') return null;
  const category = TOOL_CATEGORY[toolName];
  const tier = TOOL_TIER[toolName];
  if (!category || !tier || !categories.has(category)) return null;
  return { category, tier };
}

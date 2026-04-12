/**
 * Generate doc fragments from config.ts.
 *
 * Run: npm run generate:doc-fragments
 *
 * Reads TOOL_CATEGORY, PRESETS, DEFAULT_PRESET, and ACTION_PARAM_MAP
 * from config.ts and writes markdown fragments between paired sentinels in
 * README.md, CLAUDE.md, docs/CONFIGURATION.md.
 *
 * Also writes src/generated/doc-fragments.generated.ts so the contract test
 * can diff the live fragment set against what's currently in the docs.
 *
 * Sentinels: <!-- GENERATED:<id> START --> ... <!-- GENERATED:<id> END -->
 *
 * Fragment IDs:
 *   preset-counts            — README.md, CLAUDE.md, docs/CONFIGURATION.md
 *   category-reference       — docs/CONFIGURATION.md
 *   preset-category-map      — docs/CONFIGURATION.md
 *   claude-code-memory-note  — README.md, CLAUDE.md, docs/CONFIGURATION.md
 *   action-param-tools       — CLAUDE.md
 *   retired-tools            — docs/CONFIGURATION.md
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  TOOL_CATEGORY,
  TOOL_TIER,
  PRESETS,
  DEFAULT_PRESET,
  ALL_CATEGORIES,
  DISCLOSURE_ONLY_TOOLS,
  ACTION_PARAM_MAP,
  type ToolCategory,
} from '../src/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '../../..');
const PKG_ROOT = join(__dirname, '..');
const GENERATED_PATH = join(PKG_ROOT, 'src/generated/doc-fragments.generated.ts');

/** Presets we render into docs (ordered). Composable single-category bundles are excluded. */
const DOCUMENTED_PRESETS = ['agent', 'power', 'full', 'auto'] as const;
type DocumentedPreset = (typeof DOCUMENTED_PRESETS)[number];

/** Human-readable one-liner per preset for the preset-counts table. */
const PRESET_BEHAVIOUR: Record<DocumentedPreset, string> = {
  agent: 'Focused tier-1 surface — search, read, write, tasks, memory',
  power: 'Tier 1+2 — agent + wikilinks, corrections, note-ops, schema',
  full: 'All categories visible at startup',
  auto: 'Full surface + informational `discover_tools` helper',
};

// ============================================================================
// Derivation helpers
// ============================================================================

/** Sorted tool names for a single category, excluding disclosure-only tools. */
function toolsInCategory(category: ToolCategory): string[] {
  return Object.entries(TOOL_CATEGORY)
    .filter(([name, cat]) => cat === category && !DISCLOSURE_ONLY_TOOLS.has(name))
    .map(([name]) => name)
    .sort();
}

/**
 * Count of tools reachable under a preset.
 *
 * `auto` is a compatibility mode: it exposes the same category surface as
 * `full`, plus the informational `discover_tools` helper. That helper is only
 * registered under `auto`, so we include it for that preset alone.
 */
function countToolsInPreset(preset: DocumentedPreset): number {
  const categories = new Set(PRESETS[preset]);
  let n = 0;
  for (const [name, cat] of Object.entries(TOOL_CATEGORY)) {
    if (!categories.has(cat)) continue;
    if (DISCLOSURE_ONLY_TOOLS.has(name) && preset !== 'auto') continue;
    n += 1;
  }
  return n;
}

// ============================================================================
// Fragment renderers
// ============================================================================

function renderPresetCounts(): string {
  const rows = DOCUMENTED_PRESETS.map((preset) => {
    const count = countToolsInPreset(preset);
    const cats = PRESETS[preset].join(', ');
    const label = preset === DEFAULT_PRESET ? `\`${preset}\` (default)` : `\`${preset}\``;
    return `| ${label} | ${count} | ${cats} | ${PRESET_BEHAVIOUR[preset]} |`;
  });
  return [
    '| Preset | Tools | Categories | Behaviour |',
    '|--------|-------|------------|-----------|',
    ...rows,
  ].join('\n');
}

function renderCategoryReference(): string {
  const rows = ALL_CATEGORIES.map((cat) => {
    const tools = toolsInCategory(cat);
    return `| \`${cat}\` | ${tools.join(', ')} |`;
  });
  return [
    '| Category | Tools |',
    '|----------|-------|',
    ...rows,
  ].join('\n');
}

function renderPresetCategoryMap(): string {
  const header = `| Category | ${DOCUMENTED_PRESETS.map((p) => `\`${p}\``).join(' | ')} |`;
  const align = `|----------|${DOCUMENTED_PRESETS.map(() => ':------:').join('|')}|`;
  const rows = ALL_CATEGORIES.map((cat) => {
    const cells = DOCUMENTED_PRESETS.map((preset) =>
      PRESETS[preset].includes(cat) ? 'Yes' : ''
    );
    return `| ${cat} | ${cells.join(' | ')} |`;
  });
  return [header, align, ...rows].join('\n');
}

function renderClaudeCodeMemoryNote(): string {
  const agentCount = countToolsInPreset('agent');
  // memory (merged) is suppressed under Claude Code; memory(action: brief)
  // stays available through the remaining surface. Compute the delta rather
  // than hardcode so future removals stay correct.
  const claudeAgentCount = agentCount - 1;
  return [
    '> **Claude Code note:** the `memory` merged tool is suppressed under Claude Code',
    `> (\`CLAUDECODE=1\`) because Claude Code ships its own memory plane. Agent preset`,
    `> exposes ${claudeAgentCount} tools under Claude Code instead of ${agentCount}; \`brief\` stays available.`,
  ].join('\n');
}

function renderActionParamTools(): string {
  const names = Object.keys(ACTION_PARAM_MAP).sort();
  const lines = names.map((name) => {
    const actions = ACTION_PARAM_MAP[name].join('|');
    return `- \`${name}\` — \`action: ${actions}\``;
  });
  return lines.join('\n');
}

/**
 * Retired tools are tools referenced in prior docs that no longer exist in
 * TOOL_CATEGORY. The generator can't enumerate them from code (they're gone),
 * so we hand-maintain this list here — it only needs to grow when a new
 * removal happens, and the contract test will catch stale mentions in docs
 * through the other fragments (no retired tool can leak into category-reference
 * because that reads TOOL_CATEGORY). This fragment exists so the docs have a
 * stable section acknowledging the removals rather than silently deleting
 * previously documented tool names.
 */
const RETIRED_TOOLS: readonly string[] = [
  'semantic_analysis',
  'suggest_entity_merges',
  'dismiss_merge_suggestion',
  'vault_init',
  'flywheel_trust_report',
  'flywheel_benchmark',
  'vault_session_history',
  'vault_entity_history',
  'flywheel_learning_report',
  'flywheel_calibration_export',
  'tool_selection_feedback',
  'unlinked_mentions_report',
  'get_folder_structure',
  'health_check',
  'get_vault_stats',
  'vault_activity',
  'get_all_entities',
  'get_unlinked_mentions',
  'temporal_summary',
];

function renderRetiredTools(): string {
  // Guardrail: if any "retired" name is actually still in TOOL_CATEGORY,
  // fail the generator rather than emit a lie.
  const stillLive = RETIRED_TOOLS.filter((name) => name in TOOL_CATEGORY);
  if (stillLive.length > 0) {
    throw new Error(
      `RETIRED_TOOLS lists tools that are still registered: ${stillLive.join(', ')}`
    );
  }
  if (RETIRED_TOOLS.length === 0) return '_(none)_';
  const items = [...RETIRED_TOOLS].sort().map((name) => `- \`${name}\``);
  return items.join('\n');
}

// ============================================================================
// Fragment registry
// ============================================================================

const FRAGMENTS = {
  'preset-counts': renderPresetCounts,
  'category-reference': renderCategoryReference,
  'preset-category-map': renderPresetCategoryMap,
  'claude-code-memory-note': renderClaudeCodeMemoryNote,
  'action-param-tools': renderActionParamTools,
  'retired-tools': renderRetiredTools,
} as const;

type FragmentId = keyof typeof FRAGMENTS;

function buildAllFragments(): Record<FragmentId, string> {
  const out = {} as Record<FragmentId, string>;
  for (const id of Object.keys(FRAGMENTS) as FragmentId[]) {
    out[id] = FRAGMENTS[id]();
  }
  return out;
}

// ============================================================================
// Sentinel rewriter
// ============================================================================

/** Target doc files (relative to REPO_ROOT). */
const TARGET_FILES = [
  'README.md',
  'CLAUDE.md',
  'docs/CONFIGURATION.md',
] as const;

/**
 * Replace content between `<!-- GENERATED:<id> START -->` and
 * `<!-- GENERATED:<id> END -->` markers. Returns the new content and a list
 * of fragment IDs that were replaced.
 *
 * Sentinels that aren't present are silently skipped — docs only include the
 * fragments relevant to them.
 */
function applyFragments(
  content: string,
  fragments: Record<FragmentId, string>
): { content: string; replaced: FragmentId[] } {
  const replaced: FragmentId[] = [];
  let out = content;

  for (const id of Object.keys(fragments) as FragmentId[]) {
    const startMarker = `<!-- GENERATED:${id} START -->`;
    const endMarker = `<!-- GENERATED:${id} END -->`;
    const pattern = new RegExp(
      `${escapeRegExp(startMarker)}[\\s\\S]*?${escapeRegExp(endMarker)}`,
      'g'
    );
    if (!pattern.test(out)) continue;
    // Reset regex state before replace.
    pattern.lastIndex = 0;
    const body = fragments[id];
    out = out.replace(pattern, `${startMarker}\n${body}\n${endMarker}`);
    replaced.push(id);
  }

  return { content: out, replaced };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================================================
// Generated artifact writer
// ============================================================================

function writeGeneratedArtifact(fragments: Record<FragmentId, string>): void {
  const entries = (Object.keys(fragments) as FragmentId[])
    .map((id) => {
      // JSON.stringify gives us a safely escaped JS string literal.
      return `  ${JSON.stringify(id)}: ${JSON.stringify(fragments[id])},`;
    })
    .join('\n');

  const body = `/**
 * AUTO-GENERATED — do not edit manually.
 * Run: npm run generate:doc-fragments
 *
 * Canonical markdown fragments rendered from config.ts into docs/README/CLAUDE.md
 * via <!-- GENERATED:<id> START/END --> sentinels. The contract test in
 * test/docs/doc-fragments.test.ts diffs this against the current doc contents.
 */

/* eslint-disable */
// prettier-ignore
export const DOC_FRAGMENTS: Record<string, string> = {
${entries}
};

/** Fragment IDs as a readonly tuple for exhaustiveness checks. */
export const DOC_FRAGMENT_IDS = [
${(Object.keys(fragments) as FragmentId[]).map((id) => `  ${JSON.stringify(id)},`).join('\n')}
] as const;
`;

  writeFileSync(GENERATED_PATH, body);
}

// ============================================================================
// Main
// ============================================================================

function main(): void {
  const fragments = buildAllFragments();
  writeGeneratedArtifact(fragments);
  // eslint-disable-next-line no-console
  console.log(`[doc-fragments] wrote ${GENERATED_PATH}`);

  for (const rel of TARGET_FILES) {
    const full = join(REPO_ROOT, rel);
    if (!existsSync(full)) {
      // eslint-disable-next-line no-console
      console.warn(`[doc-fragments] skip (missing): ${rel}`);
      continue;
    }
    const before = readFileSync(full, 'utf-8');
    const { content, replaced } = applyFragments(before, fragments);
    if (content !== before) {
      writeFileSync(full, content);
      // eslint-disable-next-line no-console
      console.log(`[doc-fragments] updated ${rel} (${replaced.join(', ')})`);
    } else if (replaced.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`[doc-fragments] unchanged ${rel} (${replaced.join(', ')})`);
    } else {
      // eslint-disable-next-line no-console
      console.log(`[doc-fragments] no sentinels in ${rel}`);
    }
  }
}

main();

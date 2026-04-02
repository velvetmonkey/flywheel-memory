/**
 * Tool Choice Tests
 *
 * Validates that generateInstructions() produces correct routing guidance
 * and that tool descriptions use intent-matching language for discoverability.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs/promises';
import pathMod from 'path';
import { generateInstructions, parseEnabledCategories } from '../../../src/config.js';

// ============================================================================
// Layer 1: generateInstructions() routing assertions
// ============================================================================

describe('generateInstructions routing', () => {
  it('includes temporal routing when temporal enabled', () => {
    const cats = parseEnabledCategories('default,temporal');
    const instructions = generateInstructions(cats);
    expect(instructions).toContain('## Temporal');
    expect(instructions).toContain('track_concept_evolution');
    expect(instructions).toContain('get_context_around_date');
    expect(instructions).toContain('predict_stale_notes');
  });

  it('includes diagnostics routing when diagnostics enabled', () => {
    const cats = parseEnabledCategories('agent,diagnostics');
    const instructions = generateInstructions(cats);
    expect(instructions).toContain('## Diagnostics');
    expect(instructions).toContain('flywheel_doctor');
    expect(instructions).toContain('vault_growth');
  });

  it('includes wikilinks routing when wikilinks enabled', () => {
    const cats = parseEnabledCategories('agent,wikilinks');
    const instructions = generateInstructions(cats);
    expect(instructions).toContain('## Wikilinks');
    expect(instructions).toContain('unlinked_mentions_report');
  });

  it('includes corrections routing when corrections enabled', () => {
    const cats = parseEnabledCategories('agent,corrections');
    const instructions = generateInstructions(cats);
    expect(instructions).toContain('## Corrections');
    expect(instructions).toContain('vault_record_correction');
  });

  it('omits category blocks when not enabled', () => {
    const cats = parseEnabledCategories('agent');
    const instructions = generateInstructions(cats);
    expect(instructions).not.toContain('## Temporal');
    expect(instructions).not.toContain('## Wikilinks');
    expect(instructions).not.toContain('## Corrections');
    expect(instructions).not.toContain('## Diagnostics');
  });

  it('full preset includes all 11 category sections', () => {
    const cats = parseEnabledCategories('full');
    const instructions = generateInstructions(cats);
    for (const section of [
      'Read', 'Write', 'Memory', 'Graph', 'Note Operations',
      'Tasks', 'Schema', 'Temporal', 'Wikilinks', 'Corrections', 'Diagnostics',
    ]) {
      expect(instructions, `Missing section: ## ${section}`).toContain(`## ${section}`);
    }
  });

  it('base instructions scope search to content lookup', () => {
    const cats = parseEnabledCategories('default');
    const instructions = generateInstructions(cats);
    expect(instructions).toContain('entry point');
  });

  it('base instructions route to specialized tools for non-content questions', () => {
    const cats = parseEnabledCategories('default');
    const instructions = generateInstructions(cats);
    expect(instructions).toContain('specialized');
  });
});

// ============================================================================
// Layer 2: Tool description contract compliance — sampled assertions
// ============================================================================

describe('tool description contract compliance', () => {
  it('temporal tool descriptions expose trigger, Returns, and Does not', async () => {
    const content = await fs.readFile(
      pathMod.join(__dirname, '../../../src/tools/read/temporalAnalysis.ts'), 'utf-8');

    // Contract: each tool description must contain routing signal + Returns + Does not
    expect(content).toContain('Returns');
    expect(content).toContain('Does not');
    // Trigger phrases for temporal tools
    expect(content).toContain('Use when');
  });

  it('diagnostics tool descriptions expose trigger, Returns, and Does not', async () => {
    const content = await fs.readFile(
      pathMod.join(__dirname, '../../../src/tools/read/health.ts'), 'utf-8');

    expect(content).toContain('Returns');
    expect(content).toContain('Does not');
    expect(content).toContain('Use ');
  });

  it('activity and growth tools follow contract template', async () => {
    const sessionHistory = await fs.readFile(
      pathMod.join(__dirname, '../../../src/tools/read/sessionHistory.ts'), 'utf-8');
    const metrics = await fs.readFile(
      pathMod.join(__dirname, '../../../src/tools/read/metrics.ts'), 'utf-8');

    expect(sessionHistory).toContain('Returns');
    expect(sessionHistory).toContain('Does not');
    expect(metrics).toContain('Returns');
    expect(metrics).toContain('Does not');
  });
});

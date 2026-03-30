/**
 * Tool Choice Tests
 *
 * Validates that generateInstructions() produces correct routing guidance
 * and that tool descriptions use intent-matching language for discoverability.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { generateInstructions, parseEnabledCategories } from '../../../src/config.js';

// ============================================================================
// Layer 1: generateInstructions() routing assertions
// ============================================================================

describe('generateInstructions routing', () => {
  it('includes temporal routing when temporal enabled', () => {
    const cats = parseEnabledCategories('default,temporal');
    const instructions = generateInstructions(cats);
    expect(instructions).toContain('## Temporal');
    expect(instructions).toContain('temporal_summary');
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
    expect(instructions).toContain('content lookup');
  });

  it('base instructions route to specialized tools for non-content questions', () => {
    const cats = parseEnabledCategories('default');
    const instructions = generateInstructions(cats);
    expect(instructions).toContain('specialized tools');
  });
});

// ============================================================================
// Layer 2: Tool description distinctiveness — exact string assertions
// ============================================================================

describe('tool description distinctiveness', () => {
  it('temporal tool descriptions lead with intent-matching phrases', async () => {
    const content = await fs.readFile(
      path.join(__dirname, '../../../src/tools/read/temporalAnalysis.ts'), 'utf-8');

    expect(content).toContain("'What was happening around a specific date?");
    expect(content).toContain("'Which notes need attention?");
    expect(content).toContain("'How has an entity changed over time?");
    expect(content).toContain("'Summarize vault activity for a time period");
  });

  it('diagnostics tool descriptions lead with intent-matching phrases', async () => {
    const content = await fs.readFile(
      path.join(__dirname, '../../../src/tools/read/health.ts'), 'utf-8');

    expect(content).toContain("'Is anything broken?");
    expect(content).toContain("'What can this server do and what has it done?");
    expect(content).toContain("'Is the server getting slower?");
  });

  it('activity and growth tools lead with intent-matching phrases', async () => {
    const activity = await fs.readFile(
      path.join(__dirname, '../../../src/tools/read/activity.ts'), 'utf-8');
    const metrics = await fs.readFile(
      path.join(__dirname, '../../../src/tools/read/metrics.ts'), 'utf-8');

    expect(activity).toContain("'What tools have been used");
    expect(metrics).toContain("'How is the vault growing?");
  });
});

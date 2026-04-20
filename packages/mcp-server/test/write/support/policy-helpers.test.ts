import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import path from 'path';

import { evaluateAllConditions, evaluateCondition, shouldStepExecute } from '../../../src/core/write/policy/conditions.js';
import { POLICY_NAME_ERROR_MESSAGE, validatePolicyName } from '../../../src/core/write/policy/names.js';
import { createContext, interpolate, interpolateObject, resolveExpression, resolvePath } from '../../../src/core/write/policy/template.js';
import { cleanupTempVault, createTempVault } from '../helpers/testUtils.js';

describe('policy helper coverage', () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(vaultPath);
  });

  it('validates extensionless policy identifiers', () => {
    expect(validatePolicyName('weekly_review')).toEqual({ valid: true });
    expect(validatePolicyName(' policy')).toEqual({
      valid: false,
      reason: 'Policy name cannot have leading or trailing whitespace',
    });
    expect(validatePolicyName('weekly.review')).toEqual({
      valid: false,
      reason: 'Policy name cannot contain dots',
    });
    expect(validatePolicyName('weekly/review')).toEqual({
      valid: false,
      reason: 'Policy name cannot contain path separators',
    });
    expect(validatePolicyName('$$$')).toEqual({
      valid: false,
      reason: POLICY_NAME_ERROR_MESSAGE,
    });
  });

  it('interpolates nested values, filters, and objects', () => {
    const context = createContext({
      title: '  Project Alpha  ',
      user: { name: 'Alice', roles: ['lead', 'editor'] },
    });
    context.steps.create = { path: 'notes/project-alpha.md' };

    expect(resolvePath(context.variables, 'user.name')).toBe('Alice');
    expect(resolveExpression('title | trim | upper', context)).toBe('PROJECT ALPHA');
    expect(interpolate('Owner {{user.name}} -> {{steps.create.path}}', context)).toBe(
      'Owner Alice -> notes/project-alpha.md',
    );
    expect(interpolate('Fallback {{missing | default(untitled)}}', context)).toBe(
      'Fallback untitled',
    );
    expect(interpolateObject({
      title: '{{title | trim}}',
      roles: '{{user.roles | join( / )}}',
      nested: ['{{user.name | lower}}'],
    }, context)).toEqual({
      title: 'Project Alpha',
      roles: 'lead / editor',
      nested: ['alice'],
    });
  });

  it('evaluates file, section, and frontmatter conditions with interpolation', async () => {
    const notePath = 'projects/alpha.md';
    await fs.mkdir(path.join(vaultPath, 'projects'), { recursive: true });
    await fs.writeFile(
      path.join(vaultPath, notePath),
      '---\nstatus: active\nowner: Alice\n---\n# Alpha\n\n## Log\n\nStarted.\n',
    );

    const context = createContext({ note_path: notePath, field: 'status' });
    const fileExists = await evaluateCondition(
      { id: 'exists', check: 'file_exists', path: '{{note_path}}' },
      vaultPath,
      context,
    );
    const sectionExists = await evaluateCondition(
      { id: 'has_log', check: 'section_exists', path: '{{note_path}}', section: '## Log' },
      vaultPath,
      context,
    );
    const frontmatterEquals = await evaluateCondition(
      { id: 'status_ok', check: 'frontmatter_equals', path: '{{note_path}}', field: '{{field}}', value: 'active' },
      vaultPath,
      context,
    );

    expect(fileExists).toEqual({ met: true, reason: `File exists: ${notePath}` });
    expect(sectionExists.met).toBe(true);
    expect(frontmatterEquals.met).toBe(true);

    const all = await evaluateAllConditions([
      { id: 'exists', check: 'file_exists', path: '{{note_path}}' },
      { id: 'missing', check: 'file_not_exists', path: 'missing.md' },
    ], vaultPath, context);
    expect(all).toEqual({ exists: true, missing: true });
  });

  it('explains step execution decisions from condition results', () => {
    expect(shouldStepExecute(undefined, {})).toEqual({ execute: true });
    expect(shouldStepExecute('{{conditions.ready}}', { ready: true })).toEqual({ execute: true });
    expect(shouldStepExecute('{{conditions.ready}}', { ready: false })).toEqual({
      execute: false,
      reason: "Condition 'ready' was not met",
    });
    expect(shouldStepExecute('{{conditions.unknown}}', {})).toEqual({
      execute: false,
      reason: 'Unknown condition: unknown',
    });
  });
});

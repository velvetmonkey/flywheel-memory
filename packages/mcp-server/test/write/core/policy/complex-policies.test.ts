/**
 * Complex Policy Tests
 *
 * Validates execution of multi-step workflows that combine
 * various tools, conditions, and variables.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { executePolicy, previewPolicy } from '../../../src/core/policy/executor.js';
import type { PolicyDefinition } from '../../../src/core/policy/types.js';

let tempVault: string;

async function createTempVault(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'policy-complex-test-'));
  await fs.mkdir(path.join(dir, '.claude', 'policies'), { recursive: true });
  return dir;
}

async function cleanupTempVault(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

async function createTestNote(vaultPath: string, notePath: string, content: string): Promise<void> {
  const fullPath = path.join(vaultPath, notePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf-8');
}

async function readTestNote(vaultPath: string, notePath: string): Promise<string> {
  const fullPath = path.join(vaultPath, notePath);
  return fs.readFile(fullPath, 'utf-8');
}

async function noteExists(vaultPath: string, notePath: string): Promise<boolean> {
  try {
    await fs.access(path.join(vaultPath, notePath));
    return true;
  } catch {
    return false;
  }
}

describe('Daily Standup Workflow', () => {
  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should execute 10-step daily standup policy', async () => {
    // Setup: Create project and person notes
    await createTestNote(tempVault, 'projects/MCP Server.md', `---
type: project
status: active
---
# MCP Server

## Updates

## Blockers
`);

    await createTestNote(tempVault, 'people/Jordan.md', `---
type: person
role: engineer
---
# Jordan

## Activity

`);

    await createTestNote(tempVault, 'daily-notes/2026-02-02.md', `---
date: 2026-02-02
type: daily
---
# 2026-02-02

## Standup

## Tasks

## Log

`);

    const standupPolicy: PolicyDefinition = {
      version: '1.0',
      name: 'daily-standup',
      description: '10-step daily standup workflow',
      variables: {
        date: { type: 'string', default: '{{today}}' },
        person: { type: 'string', default: 'Jordan' },
        project: { type: 'string', default: 'MCP Server' },
        yesterday: { type: 'string', required: true },
        today_plan: { type: 'string', required: true },
        blockers: { type: 'string', default: 'None' },
      },
      conditions: [
        { id: 'daily_exists', check: 'file_exists', path: 'daily-notes/2026-02-02.md' },
        { id: 'project_exists', check: 'file_exists', path: 'projects/{{project}}.md' },
        { id: 'has_blockers', check: 'frontmatter_not_exists', path: 'daily-notes/2026-02-02.md', field: 'no_blockers' },
      ],
      steps: [
        // Step 1: Add standup summary to daily note
        {
          id: 'standup-summary',
          tool: 'vault_add_to_section',
          params: {
            path: 'daily-notes/2026-02-02.md',
            section: 'Standup',
            content: '**Yesterday:** {{yesterday}}\n**Today:** {{today_plan}}\n**Blockers:** {{blockers}}',
          },
        },
        // Step 2: Add task for today's plan
        {
          id: 'add-main-task',
          tool: 'vault_add_task',
          params: {
            path: 'daily-notes/2026-02-02.md',
            section: 'Tasks',
            task: '{{today_plan}}',
          },
        },
        // Step 3: Log activity
        {
          id: 'log-standup',
          tool: 'vault_add_to_section',
          params: {
            path: 'daily-notes/2026-02-02.md',
            section: 'Log',
            content: 'Completed standup',
            format: 'timestamp-bullet',
          },
        },
        // Step 4: Update person's activity
        {
          id: 'person-activity',
          tool: 'vault_add_to_section',
          params: {
            path: 'people/{{person}}.md',
            section: 'Activity',
            content: '2026-02-02: {{today_plan}}',
            format: 'bullet',
          },
        },
        // Step 5: Update project updates (conditional)
        {
          id: 'project-update',
          tool: 'vault_add_to_section',
          when: '{{conditions.project_exists}}',
          params: {
            path: 'projects/{{project}}.md',
            section: 'Updates',
            content: '**2026-02-02**: {{today_plan}} ({{person}})',
            format: 'bullet',
          },
        },
        // Step 6: Add blockers to project (conditional)
        {
          id: 'project-blockers',
          tool: 'vault_add_to_section',
          when: '{{conditions.has_blockers}}',
          params: {
            path: 'projects/{{project}}.md',
            section: 'Blockers',
            content: '{{blockers}} (reported by {{person}})',
            format: 'bullet',
          },
        },
        // Step 7: Update frontmatter with standup status
        {
          id: 'mark-standup-done',
          tool: 'vault_update_frontmatter',
          params: {
            path: 'daily-notes/2026-02-02.md',
            frontmatter: { standup_completed: true },
          },
        },
        // Step 8: Add follow-up task if blockers
        {
          id: 'blocker-followup',
          tool: 'vault_add_task',
          when: '{{conditions.has_blockers}}',
          params: {
            path: 'daily-notes/2026-02-02.md',
            section: 'Tasks',
            task: 'Address blockers: {{blockers}}',
          },
        },
        // Step 9: Add review task
        {
          id: 'review-task',
          tool: 'vault_add_task',
          params: {
            path: 'daily-notes/2026-02-02.md',
            section: 'Tasks',
            task: 'Review progress on {{project}}',
          },
        },
        // Step 10: Final log entry
        {
          id: 'final-log',
          tool: 'vault_add_to_section',
          params: {
            path: 'daily-notes/2026-02-02.md',
            section: 'Log',
            content: 'Standup workflow completed',
            format: 'timestamp-bullet',
          },
        },
      ],
    };

    const result = await executePolicy(standupPolicy, tempVault, {
      yesterday: 'Completed API integration',
      today_plan: 'Write unit tests for the API',
      blockers: 'Waiting for design review',
    });

    expect(result.success).toBe(true);
    expect(result.stepResults.length).toBe(10);

    // Verify daily note
    const dailyNote = await readTestNote(tempVault, 'daily-notes/2026-02-02.md');
    expect(dailyNote).toContain('Yesterday:');
    expect(dailyNote).toContain('Completed API integration');
    expect(dailyNote).toContain('Write unit tests for the API');
    expect(dailyNote).toContain('standup_completed: true');

    // Verify person note
    const personNote = await readTestNote(tempVault, 'people/Jordan.md');
    expect(personNote).toContain('Write unit tests for the API');

    // Verify project note
    const projectNote = await readTestNote(tempVault, 'projects/MCP Server.md');
    expect(projectNote).toContain('Write unit tests for the API');
    expect(projectNote).toContain('Waiting for design review');
  });
});

describe('Meeting Notes Workflow', () => {
  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should create meeting note and link attendees', async () => {
    // Setup: Create attendee notes
    await createTestNote(tempVault, 'people/Alice.md', '---\ntype: person\n---\n# Alice\n\n## Meetings\n');
    await createTestNote(tempVault, 'people/Bob.md', '---\ntype: person\n---\n# Bob\n\n## Meetings\n');

    const meetingPolicy: PolicyDefinition = {
      version: '1.0',
      name: 'create-meeting',
      description: 'Create meeting note and update attendees',
      variables: {
        title: { type: 'string', required: true },
        date: { type: 'string', required: true },
        attendees: { type: 'array', default: [] },
        agenda: { type: 'string', default: 'TBD' },
      },
      steps: [
        // Create meeting note
        {
          id: 'create-meeting-note',
          tool: 'vault_create_note',
          params: {
            path: 'meetings/{{title | slug}}.md',
            content: `# {{title}}

## Details
- **Date:** {{date}}
- **Attendees:** Alice, Bob

## Agenda
{{agenda}}

## Notes

## Action Items
`,
            frontmatter: {
              type: 'meeting',
              date: '{{date}}',
            },
          },
        },
        // Update Alice's meetings
        {
          id: 'update-alice',
          tool: 'vault_add_to_section',
          params: {
            path: 'people/Alice.md',
            section: 'Meetings',
            content: '[[{{title | slug}}]] - {{date}}',
            format: 'bullet',
          },
        },
        // Update Bob's meetings
        {
          id: 'update-bob',
          tool: 'vault_add_to_section',
          params: {
            path: 'people/Bob.md',
            section: 'Meetings',
            content: '[[{{title | slug}}]] - {{date}}',
            format: 'bullet',
          },
        },
      ],
    };

    const result = await executePolicy(meetingPolicy, tempVault, {
      title: 'Sprint Planning',
      date: '2026-02-03',
      agenda: 'Review backlog and assign tasks',
    });

    expect(result.success).toBe(true);

    // Verify meeting note created
    expect(await noteExists(tempVault, 'meetings/sprint-planning.md')).toBe(true);

    const meetingNote = await readTestNote(tempVault, 'meetings/sprint-planning.md');
    expect(meetingNote).toContain('# Sprint Planning');
    expect(meetingNote).toContain('Review backlog and assign tasks');

    // Verify attendee links
    const aliceNote = await readTestNote(tempVault, 'people/Alice.md');
    expect(aliceNote).toContain('sprint-planning');

    const bobNote = await readTestNote(tempVault, 'people/Bob.md');
    expect(bobNote).toContain('sprint-planning');
  });
});

describe('Decision Record Workflow', () => {
  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should create ADR with project link', async () => {
    await createTestNote(tempVault, 'projects/Platform.md', `---
type: project
---
# Platform

## Decisions
`);

    const adrPolicy: PolicyDefinition = {
      version: '1.0',
      name: 'create-adr',
      description: 'Create architectural decision record',
      variables: {
        title: { type: 'string', required: true },
        context: { type: 'string', required: true },
        decision: { type: 'string', required: true },
        consequences: { type: 'string', required: true },
        project: { type: 'string', default: 'Platform' },
      },
      conditions: [
        { id: 'project_exists', check: 'file_exists', path: 'projects/{{project}}.md' },
      ],
      steps: [
        {
          id: 'create-adr',
          tool: 'vault_create_note',
          params: {
            path: 'decisions/{{title | slug}}.md',
            content: `# {{title}}

## Status
Proposed

## Context
{{context}}

## Decision
{{decision}}

## Consequences
{{consequences}}

## Related
- Project: [[{{project}}]]
`,
            frontmatter: {
              type: 'decision',
              status: 'proposed',
              date: '{{today}}',
            },
          },
        },
        {
          id: 'link-to-project',
          tool: 'vault_add_to_section',
          when: '{{conditions.project_exists}}',
          params: {
            path: 'projects/{{project}}.md',
            section: 'Decisions',
            content: '[[{{title | slug}}]] - {{today}}',
            format: 'bullet',
          },
        },
      ],
    };

    const result = await executePolicy(adrPolicy, tempVault, {
      title: 'Use PostgreSQL for persistence',
      context: 'Need a reliable database for user data',
      decision: 'We will use PostgreSQL',
      consequences: 'Team needs PostgreSQL knowledge',
    });

    expect(result.success).toBe(true);

    const adrNote = await readTestNote(tempVault, 'decisions/use-postgresql-for-persistence.md');
    expect(adrNote).toContain('# Use PostgreSQL for persistence');
    expect(adrNote).toContain('Need a reliable database');
    expect(adrNote).toContain('[[Platform]]');

    const projectNote = await readTestNote(tempVault, 'projects/Platform.md');
    expect(projectNote).toContain('use-postgresql-for-persistence');
  });
});

describe('Policy Preview', () => {
  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should preview complex policy without executing', async () => {
    await createTestNote(tempVault, 'test.md', '# Log\n');

    const policy: PolicyDefinition = {
      version: '1.0',
      name: 'preview-test',
      description: 'Test preview',
      variables: {
        message: { type: 'string', default: 'Hello' },
        count: { type: 'number', default: 5 },
      },
      conditions: [
        { id: 'file_check', check: 'file_exists', path: 'test.md' },
        { id: 'missing_check', check: 'file_exists', path: 'missing.md' },
      ],
      steps: [
        {
          id: 'step1',
          tool: 'vault_add_to_section',
          params: { path: 'test.md', section: 'Log', content: '{{message}}' },
        },
        {
          id: 'step2',
          tool: 'vault_add_to_section',
          when: '{{conditions.missing_check}}',
          params: { path: 'missing.md', section: 'X', content: 'skip' },
        },
      ],
    };

    const preview = await previewPolicy(policy, tempVault, { message: 'Custom message' });

    expect(preview.policyName).toBe('preview-test');
    expect(preview.resolvedVariables.message).toBe('Custom message');
    expect(preview.resolvedVariables.count).toBe(5);
    expect(preview.conditionResults.file_check).toBe(true);
    expect(preview.conditionResults.missing_check).toBe(false);
    expect(preview.stepsToExecute[0].skipped).toBe(false);
    expect(preview.stepsToExecute[1].skipped).toBe(true);
    expect(preview.filesAffected).toContain('test.md');

    // Verify no changes made
    const content = await readTestNote(tempVault, 'test.md');
    expect(content).not.toContain('Custom message');
  });
});

describe('Error Recovery Patterns', () => {
  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should provide detailed step-by-step results', async () => {
    await createTestNote(tempVault, 'a.md', '# Log\n');
    await createTestNote(tempVault, 'b.md', '# Log\n');

    const policy: PolicyDefinition = {
      version: '1.0',
      name: 'detailed-results',
      description: 'Test detailed results',
      steps: [
        { id: 'success1', tool: 'vault_add_to_section', params: { path: 'a.md', section: 'Log', content: 'A' } },
        { id: 'success2', tool: 'vault_add_to_section', params: { path: 'b.md', section: 'Log', content: 'B' } },
        { id: 'fail', tool: 'vault_add_to_section', params: { path: 'missing.md', section: 'X', content: 'F' } },
      ],
    };

    const result = await executePolicy(policy, tempVault, {});

    expect(result.stepResults[0].stepId).toBe('success1');
    expect(result.stepResults[0].success).toBe(true);
    expect(result.stepResults[0].path).toBe('a.md');

    expect(result.stepResults[1].stepId).toBe('success2');
    expect(result.stepResults[1].success).toBe(true);

    expect(result.stepResults[2].stepId).toBe('fail');
    expect(result.stepResults[2].success).toBe(false);
    expect(result.stepResults[2].message).toBeDefined();
  });
});

// ============================================================================
// ENTERPRISE WORKFLOW TESTS (P3)
// Validates complex business process automation scenarios
// ============================================================================

describe('State Machine Workflows', () => {
  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should transition document through draft → review → approved states', async () => {
    // Setup: Create document in draft state
    await createTestNote(tempVault, 'docs/proposal.md', `---
type: document
status: draft
author: Alice
created: 2026-02-01
---
# Project Proposal

## Content
Initial draft content.

## Review Notes

## Approval History
`);

    // Policy: Transition from draft to review
    const submitForReviewPolicy: PolicyDefinition = {
      version: '1.0',
      name: 'submit-for-review',
      description: 'Move document from draft to review state',
      variables: {
        doc_path: { type: 'string', required: true },
        reviewer: { type: 'string', required: true },
      },
      conditions: [
        { id: 'is_draft', check: 'frontmatter_equals', path: '{{doc_path}}', field: 'status', value: 'draft' },
      ],
      steps: [
        {
          id: 'update-status',
          tool: 'vault_update_frontmatter',
          when: '{{conditions.is_draft}}',
          params: {
            path: '{{doc_path}}',
            frontmatter: {
              status: 'review',
              reviewer: '{{reviewer}}',
              submitted_at: '{{today}}',
            },
          },
        },
        {
          id: 'add-review-entry',
          tool: 'vault_add_to_section',
          when: '{{conditions.is_draft}}',
          params: {
            path: '{{doc_path}}',
            section: 'Review Notes',
            content: 'Submitted for review by {{author}} on {{today}}. Assigned to {{reviewer}}.',
            format: 'bullet',
          },
        },
      ],
    };

    const reviewResult = await executePolicy(submitForReviewPolicy, tempVault, {
      doc_path: 'docs/proposal.md',
      reviewer: 'Bob',
      author: 'Alice',
    });

    expect(reviewResult.success).toBe(true);

    // Verify state transition
    const afterReview = await readTestNote(tempVault, 'docs/proposal.md');
    expect(afterReview).toContain('status: review');
    expect(afterReview).toContain('reviewer: Bob');
    expect(afterReview).toContain('Submitted for review');

    // Policy: Approve the document
    const approvePolicy: PolicyDefinition = {
      version: '1.0',
      name: 'approve-document',
      description: 'Move document from review to approved state',
      variables: {
        doc_path: { type: 'string', required: true },
        approver: { type: 'string', required: true },
      },
      conditions: [
        { id: 'is_review', check: 'frontmatter_equals', path: '{{doc_path}}', field: 'status', value: 'review' },
      ],
      steps: [
        {
          id: 'update-status',
          tool: 'vault_update_frontmatter',
          when: '{{conditions.is_review}}',
          params: {
            path: '{{doc_path}}',
            frontmatter: {
              status: 'approved',
              approved_by: '{{approver}}',
              approved_at: '{{today}}',
            },
          },
        },
        {
          id: 'add-approval-entry',
          tool: 'vault_add_to_section',
          when: '{{conditions.is_review}}',
          params: {
            path: '{{doc_path}}',
            section: 'Approval History',
            content: 'Approved by {{approver}} on {{today}}',
            format: 'bullet',
          },
        },
      ],
    };

    const approveResult = await executePolicy(approvePolicy, tempVault, {
      doc_path: 'docs/proposal.md',
      approver: 'Carol',
    });

    expect(approveResult.success).toBe(true);

    // Verify final state
    const finalDoc = await readTestNote(tempVault, 'docs/proposal.md');
    expect(finalDoc).toContain('status: approved');
    expect(finalDoc).toContain('approved_by: Carol');
    expect(finalDoc).toContain('Approved by Carol');
  });

  it('should prevent invalid state transitions', async () => {
    // Setup: Create already-approved document
    await createTestNote(tempVault, 'docs/final.md', `---
type: document
status: approved
---
# Final Document

## Review Notes
`);

    // Try to submit for review (should skip - not in draft state)
    const submitPolicy: PolicyDefinition = {
      version: '1.0',
      name: 'submit-for-review',
      description: 'Cannot submit approved document for review',
      conditions: [
        { id: 'is_draft', check: 'frontmatter_equals', path: 'docs/final.md', field: 'status', value: 'draft' },
      ],
      steps: [
        {
          id: 'update-status',
          tool: 'vault_update_frontmatter',
          when: '{{conditions.is_draft}}',
          params: {
            path: 'docs/final.md',
            frontmatter: { status: 'review' },
          },
        },
      ],
    };

    const result = await executePolicy(submitPolicy, tempVault, {});

    expect(result.success).toBe(true); // Policy succeeds
    expect(result.stepResults[0].skipped).toBe(true); // But step is skipped

    // Status should NOT change
    const doc = await readTestNote(tempVault, 'docs/final.md');
    expect(doc).toContain('status: approved');
    expect(doc).not.toContain('status: review');
  });
});

describe('Approval Chain Workflows', () => {
  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should handle multi-tier approval chain', async () => {
    // Setup: Expense request requiring manager → finance → executive approval
    await createTestNote(tempVault, 'requests/expense-001.md', `---
type: expense-request
status: pending
amount: 15000
department: Engineering
requester: Alice
tier1_approved: false
tier2_approved: false
tier3_approved: false
---
# Expense Request: New Servers

## Details
- Amount: $15,000
- Purpose: Development infrastructure

## Approvals

## Notes
`);

    // Tier 1: Manager approval
    const tier1Policy: PolicyDefinition = {
      version: '1.0',
      name: 'manager-approval',
      description: 'First-tier manager approval',
      variables: {
        request_path: { type: 'string', required: true },
        manager: { type: 'string', required: true },
      },
      conditions: [
        { id: 'is_pending', check: 'frontmatter_equals', path: '{{request_path}}', field: 'status', value: 'pending' },
        { id: 'not_tier1_approved', check: 'frontmatter_equals', path: '{{request_path}}', field: 'tier1_approved', value: false },
      ],
      steps: [
        {
          id: 'approve-tier1',
          tool: 'vault_update_frontmatter',
          when: '{{conditions.is_pending}}',
          params: {
            path: '{{request_path}}',
            frontmatter: {
              tier1_approved: true,
              tier1_approver: '{{manager}}',
              tier1_date: '{{today}}',
              status: 'tier1-approved',
            },
          },
        },
        {
          id: 'log-tier1',
          tool: 'vault_add_to_section',
          when: '{{conditions.is_pending}}',
          params: {
            path: '{{request_path}}',
            section: 'Approvals',
            content: '**Tier 1 (Manager):** Approved by {{manager}} on {{today}}',
            format: 'bullet',
          },
        },
      ],
    };

    const tier1Result = await executePolicy(tier1Policy, tempVault, {
      request_path: 'requests/expense-001.md',
      manager: 'Bob',
    });
    expect(tier1Result.success).toBe(true);

    // Tier 2: Finance approval
    const tier2Policy: PolicyDefinition = {
      version: '1.0',
      name: 'finance-approval',
      description: 'Second-tier finance approval',
      variables: {
        request_path: { type: 'string', required: true },
        finance_officer: { type: 'string', required: true },
      },
      conditions: [
        { id: 'tier1_done', check: 'frontmatter_equals', path: '{{request_path}}', field: 'tier1_approved', value: true },
        { id: 'not_tier2', check: 'frontmatter_equals', path: '{{request_path}}', field: 'tier2_approved', value: false },
      ],
      steps: [
        {
          id: 'approve-tier2',
          tool: 'vault_update_frontmatter',
          when: '{{conditions.tier1_done}}',
          params: {
            path: '{{request_path}}',
            frontmatter: {
              tier2_approved: true,
              tier2_approver: '{{finance_officer}}',
              tier2_date: '{{today}}',
              status: 'tier2-approved',
            },
          },
        },
        {
          id: 'log-tier2',
          tool: 'vault_add_to_section',
          when: '{{conditions.tier1_done}}',
          params: {
            path: '{{request_path}}',
            section: 'Approvals',
            content: '**Tier 2 (Finance):** Approved by {{finance_officer}} on {{today}}',
            format: 'bullet',
          },
        },
      ],
    };

    const tier2Result = await executePolicy(tier2Policy, tempVault, {
      request_path: 'requests/expense-001.md',
      finance_officer: 'Carol',
    });
    expect(tier2Result.success).toBe(true);

    // Tier 3: Executive approval (final)
    const tier3Policy: PolicyDefinition = {
      version: '1.0',
      name: 'executive-approval',
      description: 'Third-tier executive approval',
      variables: {
        request_path: { type: 'string', required: true },
        executive: { type: 'string', required: true },
      },
      conditions: [
        { id: 'tier2_done', check: 'frontmatter_equals', path: '{{request_path}}', field: 'tier2_approved', value: true },
        { id: 'not_tier3', check: 'frontmatter_equals', path: '{{request_path}}', field: 'tier3_approved', value: false },
      ],
      steps: [
        {
          id: 'approve-tier3',
          tool: 'vault_update_frontmatter',
          when: '{{conditions.tier2_done}}',
          params: {
            path: '{{request_path}}',
            frontmatter: {
              tier3_approved: true,
              tier3_approver: '{{executive}}',
              tier3_date: '{{today}}',
              status: 'fully-approved',
            },
          },
        },
        {
          id: 'log-tier3',
          tool: 'vault_add_to_section',
          when: '{{conditions.tier2_done}}',
          params: {
            path: '{{request_path}}',
            section: 'Approvals',
            content: '**Tier 3 (Executive):** Approved by {{executive}} on {{today}}',
            format: 'bullet',
          },
        },
        {
          id: 'final-note',
          tool: 'vault_add_to_section',
          when: '{{conditions.tier2_done}}',
          params: {
            path: '{{request_path}}',
            section: 'Notes',
            content: 'Request fully approved and ready for processing.',
            format: 'bullet',
          },
        },
      ],
    };

    const tier3Result = await executePolicy(tier3Policy, tempVault, {
      request_path: 'requests/expense-001.md',
      executive: 'Dave',
    });
    expect(tier3Result.success).toBe(true);

    // Verify final state
    const finalRequest = await readTestNote(tempVault, 'requests/expense-001.md');
    expect(finalRequest).toContain('status: fully-approved');
    expect(finalRequest).toContain('tier1_approved: true');
    expect(finalRequest).toContain('tier2_approved: true');
    expect(finalRequest).toContain('tier3_approved: true');
    expect(finalRequest).toContain('Tier 1 (Manager)');
    expect(finalRequest).toContain('Tier 2 (Finance)');
    expect(finalRequest).toContain('Tier 3 (Executive)');
    expect(finalRequest).toContain('fully approved');
  });

  it('should block approval chain if prerequisite not met', async () => {
    // Setup: Request NOT tier1 approved
    await createTestNote(tempVault, 'requests/expense-002.md', `---
type: expense-request
status: pending
tier1_approved: false
tier2_approved: false
---
# Expense Request

## Approvals
`);

    // Try tier 2 approval without tier 1
    const tier2Policy: PolicyDefinition = {
      version: '1.0',
      name: 'finance-approval',
      description: 'Requires tier1 first',
      conditions: [
        { id: 'tier1_done', check: 'frontmatter_equals', path: 'requests/expense-002.md', field: 'tier1_approved', value: true },
      ],
      steps: [
        {
          id: 'approve-tier2',
          tool: 'vault_update_frontmatter',
          when: '{{conditions.tier1_done}}',
          params: {
            path: 'requests/expense-002.md',
            frontmatter: { tier2_approved: true, status: 'tier2-approved' },
          },
        },
      ],
    };

    const result = await executePolicy(tier2Policy, tempVault, {});

    expect(result.success).toBe(true); // Policy succeeds (conditions checked)
    expect(result.stepResults[0].skipped).toBe(true); // Step skipped

    const request = await readTestNote(tempVault, 'requests/expense-002.md');
    expect(request).toContain('status: pending'); // Unchanged
    expect(request).toContain('tier2_approved: false'); // Unchanged
  });
});

describe('Complex Conditional Branching', () => {
  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should handle multiple independent conditions', async () => {
    // Setup: Project with various states
    await createTestNote(tempVault, 'projects/alpha.md', `---
type: project
status: active
has_budget: true
needs_review: true
is_urgent: false
---
# Project Alpha

## Budget Updates

## Review Tasks

## Urgent Actions

## Activity Log
`);

    const multiConditionPolicy: PolicyDefinition = {
      version: '1.0',
      name: 'project-update',
      description: 'Update project based on multiple conditions',
      variables: {
        project_path: { type: 'string', required: true },
      },
      conditions: [
        { id: 'is_active', check: 'frontmatter_equals', path: '{{project_path}}', field: 'status', value: 'active' },
        { id: 'has_budget', check: 'frontmatter_equals', path: '{{project_path}}', field: 'has_budget', value: true },
        { id: 'needs_review', check: 'frontmatter_equals', path: '{{project_path}}', field: 'needs_review', value: true },
        { id: 'is_urgent', check: 'frontmatter_equals', path: '{{project_path}}', field: 'is_urgent', value: true },
      ],
      steps: [
        // Always log activity if active
        {
          id: 'log-activity',
          tool: 'vault_add_to_section',
          when: '{{conditions.is_active}}',
          params: {
            path: '{{project_path}}',
            section: 'Activity Log',
            content: 'Automated check on {{today}}',
            format: 'timestamp-bullet',
          },
        },
        // Only if has budget
        {
          id: 'budget-update',
          tool: 'vault_add_to_section',
          when: '{{conditions.has_budget}}',
          params: {
            path: '{{project_path}}',
            section: 'Budget Updates',
            content: 'Budget allocation confirmed',
            format: 'bullet',
          },
        },
        // Only if needs review
        {
          id: 'review-task',
          tool: 'vault_add_task',
          when: '{{conditions.needs_review}}',
          params: {
            path: '{{project_path}}',
            section: 'Review Tasks',
            task: 'Complete scheduled review',
          },
        },
        // Only if urgent (should be skipped)
        {
          id: 'urgent-action',
          tool: 'vault_add_to_section',
          when: '{{conditions.is_urgent}}',
          params: {
            path: '{{project_path}}',
            section: 'Urgent Actions',
            content: 'URGENT: Immediate attention required',
            format: 'bullet',
          },
        },
      ],
    };

    const result = await executePolicy(multiConditionPolicy, tempVault, {
      project_path: 'projects/alpha.md',
    });

    expect(result.success).toBe(true);
    expect(result.stepResults).toHaveLength(4);

    // Check which steps ran
    expect(result.stepResults[0].skipped).toBeFalsy(); // is_active = true
    expect(result.stepResults[1].skipped).toBeFalsy(); // has_budget = true
    expect(result.stepResults[2].skipped).toBeFalsy(); // needs_review = true
    expect(result.stepResults[3].skipped).toBe(true);  // is_urgent = false

    // Verify content
    const project = await readTestNote(tempVault, 'projects/alpha.md');
    expect(project).toContain('Automated check');
    expect(project).toContain('Budget allocation confirmed');
    expect(project).toContain('Complete scheduled review');
    expect(project).not.toContain('URGENT'); // Skipped
  });

  it('should handle conditional note creation and linking', async () => {
    // Setup: Client with specific configuration
    await createTestNote(tempVault, 'clients/acme.md', `---
type: client
tier: enterprise
requires_nda: true
active: true
---
# ACME Corporation

## Projects

## Documents
`);

    const clientOnboardingPolicy: PolicyDefinition = {
      version: '1.0',
      name: 'client-project-setup',
      description: 'Create project with conditional NDA',
      variables: {
        client_path: { type: 'string', required: true },
        project_name: { type: 'string', required: true },
        client_name: { type: 'string', required: true },
      },
      conditions: [
        { id: 'is_enterprise', check: 'frontmatter_equals', path: '{{client_path}}', field: 'tier', value: 'enterprise' },
        { id: 'needs_nda', check: 'frontmatter_equals', path: '{{client_path}}', field: 'requires_nda', value: true },
        { id: 'is_active', check: 'frontmatter_equals', path: '{{client_path}}', field: 'active', value: true },
      ],
      steps: [
        // Create project note
        {
          id: 'create-project',
          tool: 'vault_create_note',
          when: '{{conditions.is_active}}',
          params: {
            path: 'projects/{{project_name | slug}}.md',
            content: `# {{project_name}}

## Overview
Client: [[{{client_name}}]]
Tier: Enterprise

## Status

## Deliverables
`,
            frontmatter: {
              type: 'project',
              client: '{{client_name}}',
              status: 'initiated',
              created: '{{today}}',
            },
          },
        },
        // Link project to client
        {
          id: 'link-to-client',
          tool: 'vault_add_to_section',
          when: '{{conditions.is_active}}',
          params: {
            path: '{{client_path}}',
            section: 'Projects',
            content: '[[{{project_name | slug}}]] - Started {{today}}',
            format: 'bullet',
          },
        },
        // Create NDA doc only for clients that need it
        {
          id: 'create-nda',
          tool: 'vault_create_note',
          when: '{{conditions.needs_nda}}',
          params: {
            path: 'legal/nda-{{client_name | slug}}.md',
            content: `# NDA: {{client_name}}

## Status
Pending signature

## Terms
Standard enterprise NDA terms apply.
`,
            frontmatter: {
              type: 'nda',
              client: '{{client_name}}',
              status: 'pending',
            },
          },
        },
        // Link NDA to client
        {
          id: 'link-nda',
          tool: 'vault_add_to_section',
          when: '{{conditions.needs_nda}}',
          params: {
            path: '{{client_path}}',
            section: 'Documents',
            content: '[[nda-{{client_name | slug}}]] - NDA (pending)',
            format: 'bullet',
          },
        },
      ],
    };

    const result = await executePolicy(clientOnboardingPolicy, tempVault, {
      client_path: 'clients/acme.md',
      project_name: 'Digital Transformation',
      client_name: 'ACME Corporation',
    });

    expect(result.success).toBe(true);

    // Project should exist
    expect(await noteExists(tempVault, 'projects/digital-transformation.md')).toBe(true);
    const project = await readTestNote(tempVault, 'projects/digital-transformation.md');
    expect(project).toContain('[[ACME Corporation]]');

    // NDA should exist (requires_nda = true)
    expect(await noteExists(tempVault, 'legal/nda-acme-corporation.md')).toBe(true);
    const nda = await readTestNote(tempVault, 'legal/nda-acme-corporation.md');
    expect(nda).toContain('Standard enterprise NDA terms');

    // Client should have links
    const client = await readTestNote(tempVault, 'clients/acme.md');
    expect(client).toContain('[[digital-transformation]]');
    expect(client).toContain('[[nda-acme-corporation]]');
  });
});

describe('Multi-Entity Updates', () => {
  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should update multiple related entities atomically', async () => {
    // Setup: Team structure
    await createTestNote(tempVault, 'teams/engineering.md', `---
type: team
member_count: 5
---
# Engineering Team

## Members

## Recent Updates
`);

    await createTestNote(tempVault, 'people/new-hire.md', `---
type: person
status: pending
team: null
---
# New Hire

## Activity
`);

    await createTestNote(tempVault, 'hr/onboarding.md', `---
type: tracker
---
# Onboarding Tracker

## Completed

## Pending
`);

    const onboardingPolicy: PolicyDefinition = {
      version: '1.0',
      name: 'complete-onboarding',
      description: 'Finalize employee onboarding across entities',
      variables: {
        person_path: { type: 'string', required: true },
        team_path: { type: 'string', required: true },
        person_name: { type: 'string', required: true },
        team_name: { type: 'string', required: true },
      },
      conditions: [
        { id: 'is_pending', check: 'frontmatter_equals', path: '{{person_path}}', field: 'status', value: 'pending' },
      ],
      steps: [
        // Update person status
        {
          id: 'activate-person',
          tool: 'vault_update_frontmatter',
          when: '{{conditions.is_pending}}',
          params: {
            path: '{{person_path}}',
            frontmatter: {
              status: 'active',
              team: '{{team_name}}',
              start_date: '{{today}}',
            },
          },
        },
        // Add to team members
        {
          id: 'add-to-team',
          tool: 'vault_add_to_section',
          when: '{{conditions.is_pending}}',
          params: {
            path: '{{team_path}}',
            section: 'Members',
            content: '[[{{person_name}}]] - Joined {{today}}',
            format: 'bullet',
          },
        },
        // Update team activity
        {
          id: 'team-update',
          tool: 'vault_add_to_section',
          when: '{{conditions.is_pending}}',
          params: {
            path: '{{team_path}}',
            section: 'Recent Updates',
            content: 'New team member: [[{{person_name}}]]',
            format: 'timestamp-bullet',
          },
        },
        // Log person activity
        {
          id: 'person-activity',
          tool: 'vault_add_to_section',
          when: '{{conditions.is_pending}}',
          params: {
            path: '{{person_path}}',
            section: 'Activity',
            content: 'Joined [[{{team_name}}]] team',
            format: 'timestamp-bullet',
          },
        },
        // Update HR tracker
        {
          id: 'hr-complete',
          tool: 'vault_add_to_section',
          when: '{{conditions.is_pending}}',
          params: {
            path: 'hr/onboarding.md',
            section: 'Completed',
            content: '[[{{person_name}}]] - {{team_name}} - {{today}}',
            format: 'bullet',
          },
        },
      ],
    };

    const result = await executePolicy(onboardingPolicy, tempVault, {
      person_path: 'people/new-hire.md',
      team_path: 'teams/engineering.md',
      person_name: 'New Hire',
      team_name: 'Engineering',
    });

    expect(result.success).toBe(true);
    expect(result.stepResults.filter(s => s.success)).toHaveLength(5);

    // Verify all entities updated
    const person = await readTestNote(tempVault, 'people/new-hire.md');
    expect(person).toContain('status: active');
    expect(person).toContain('team: Engineering');
    expect(person).toContain('Joined [[Engineering]]');

    const team = await readTestNote(tempVault, 'teams/engineering.md');
    expect(team).toContain('[[New Hire]]');
    expect(team).toContain('New team member');

    const tracker = await readTestNote(tempVault, 'hr/onboarding.md');
    expect(tracker).toContain('[[New Hire]]');
    expect(tracker).toContain('Engineering');
  });
});

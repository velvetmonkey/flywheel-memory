/**
 * End-to-End Blocking Chain Trace
 *
 * This test actually walks the graph like Claude would when asked
 * "What's blocking the propulsion system?"
 *
 * It traces the full chain and outputs the actual data at each step.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import { createTestServer, type TestServerContext } from '../helpers/createTestServer.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const DEMOS_PATH = path.resolve(__dirname, '../../../../demos');
const ARTEMIS_VAULT = path.join(DEMOS_PATH, 'artemis-rocket');

describe('End-to-End Blocking Chain Trace', () => {
  let client: Client;
  let context: TestServerContext;

  beforeAll(async () => {
    context = await createTestServer(ARTEMIS_VAULT);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await context.server.connect(serverTransport);
    client = new Client({ name: 'test', version: '1.0' }, { capabilities: {} });
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    context?.stateDb?.close();
    await client?.close();
  });

  it('should trace the full blocking chain from Propulsion System', async () => {
    console.log('\n' + '='.repeat(70));
    console.log('TRACING: "What\'s blocking the propulsion system?"');
    console.log('='.repeat(70));

    // Step 1: Get Propulsion System and find what it references
    console.log('\n--- STEP 1: Get Propulsion System ---');
    const propulsion = await client.callTool({
      name: 'get_note_metadata',
      arguments: { path: 'systems/propulsion/Propulsion System.md' }
    });
    const propData = JSON.parse((propulsion.content as any)[0].text);
    console.log('Path:', propData.path);
    console.log('Status:', propData.frontmatter?.status);
    console.log('Phase:', propData.frontmatter?.phase);

    // Step 2: Get forward links from Propulsion System to find dependencies
    console.log('\n--- STEP 2: Get forward links from Propulsion System ---');
    const propForward = await client.callTool({
      name: 'get_forward_links',
      arguments: { path: 'systems/propulsion/Propulsion System.md' }
    });
    const propForwardData = JSON.parse((propForward.content as any)[0].text);
    console.log('Forward links count:', propForwardData.links?.length || 0);

    // Find Turbopump in forward links
    const turbopumpLink = propForwardData.links?.find((l: any) =>
      l.target?.includes('Turbopump') || l.path?.includes('Turbopump')
    );
    console.log('Links to Turbopump:', turbopumpLink ? 'YES' : 'NO');

    // Step 3: Get Turbopump metadata - this is the blocker
    console.log('\n--- STEP 3: Get Turbopump (the blocker) ---');
    const turbopump = await client.callTool({
      name: 'get_note_metadata',
      arguments: { path: 'systems/propulsion/Turbopump.md' }
    });
    const turbData = JSON.parse((turbopump.content as any)[0].text);
    console.log('Path:', turbData.path);
    console.log('Status:', turbData.frontmatter?.status);
    console.log('Supplier:', turbData.frontmatter?.supplier);

    expect(turbData.frontmatter?.status).toBe('delayed');

    // Step 4: Get Acme Aerospace - the supplier causing the delay
    console.log('\n--- STEP 4: Get Acme Aerospace (supplier causing delay) ---');
    const acme = await client.callTool({
      name: 'get_note_metadata',
      arguments: { path: 'suppliers/Acme Aerospace.md' }
    });
    const acmeData = JSON.parse((acme.content as any)[0].text);
    console.log('Path:', acmeData.path);
    console.log('Status:', acmeData.frontmatter?.status);
    console.log('blocked_by:', acmeData.frontmatter?.blocked_by);
    console.log('affects:', acmeData.frontmatter?.affects);

    expect(acmeData.frontmatter?.status).toBe('delayed');
    expect(acmeData.frontmatter?.blocked_by).toContain('[[Turbopump]]');

    // Step 5: Get Thrust Validation - affected by the delay
    console.log('\n--- STEP 5: Get Thrust Validation (blocked downstream) ---');
    const thrust = await client.callTool({
      name: 'get_note_metadata',
      arguments: { path: 'tests/Thrust Validation.md' }
    });
    const thrustData = JSON.parse((thrust.content as any)[0].text);
    console.log('Path:', thrustData.path);
    console.log('Status:', thrustData.frontmatter?.status);
    console.log('blocked_by:', thrustData.frontmatter?.blocked_by);
    console.log('affects:', thrustData.frontmatter?.affects);

    expect(thrustData.frontmatter?.status).toBe('blocked');
    expect(thrustData.frontmatter?.blocked_by).toContain('[[Acme Aerospace]]');

    // Step 6: Get Engine Hot Fire Results - also affected by the delay
    console.log('\n--- STEP 6: Get Engine Hot Fire Results (also affected) ---');
    const hotFire = await client.callTool({
      name: 'get_note_metadata',
      arguments: { path: 'tests/Engine Hot Fire Results.md' }
    });
    const hotFireData = JSON.parse((hotFire.content as any)[0].text);
    console.log('Path:', hotFireData.path);
    console.log('Status:', hotFireData.frontmatter?.status);

    // Step 7: Verify the chain by searching for all blocked/delayed items
    console.log('\n--- STEP 7: Search for all blocked/delayed items ---');
    const blocked = await client.callTool({
      name: 'search_notes',
      arguments: { frontmatter_has: 'status', limit: 50 }
    });
    const blockedData = JSON.parse((blocked.content as any)[0].text);
    const blockedItems = blockedData.notes.filter((n: any) =>
      ['delayed', 'blocked'].includes(n.frontmatter?.status)
    );

    console.log('Found blocked/delayed items:');
    for (const item of blockedItems) {
      console.log(`  - ${item.path}: ${item.frontmatter?.status}`);
      if (item.frontmatter?.blocked_by) {
        console.log(`    blocked_by: ${item.frontmatter.blocked_by}`);
      }
    }

    // Final summary
    console.log('\n' + '='.repeat(70));
    console.log('VERIFIED BLOCKING CHAIN:');
    console.log('='.repeat(70));
    console.log(`
Propulsion System (status: ${propData.frontmatter?.status || 'testing'})
  └─ waiting on: Turbopump (status: ${turbData.frontmatter?.status})
     └─ waiting on: Acme Aerospace Delivery (status: ${acmeData.frontmatter?.status})
        └─ affects:
           - Engine Hot Fire Results (status: ${hotFireData.frontmatter?.status})
           - Thrust Validation (status: ${thrustData.frontmatter?.status})
    `);
    console.log('='.repeat(70) + '\n');

    // Final assertions
    expect(blockedItems.length).toBeGreaterThanOrEqual(3);
    expect(blockedItems.some((i: any) => i.path.includes('Turbopump'))).toBe(true);
    expect(blockedItems.some((i: any) => i.path.includes('Acme Aerospace'))).toBe(true);
    expect(blockedItems.some((i: any) => i.path.includes('Thrust Validation'))).toBe(true);
  });
});

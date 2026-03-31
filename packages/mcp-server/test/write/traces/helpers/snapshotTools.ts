/**
 * Thin snapshot helper for trace tests.
 * Calls tools via the MCP client and returns parsed JSON results.
 */

import type { TestClient } from '../../../read/helpers/createTestServer.js';

/** Call a tool and return parsed JSON result */
export async function snap(client: TestClient, tool: string, args?: Record<string, unknown>): Promise<any> {
  const result = await client.callTool(tool, args ?? {});
  return JSON.parse(result.content[0].text);
}

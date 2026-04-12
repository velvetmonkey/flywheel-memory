import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

class TestTransport implements Transport {
  onmessage?: (message: JSONRPCMessage) => void;
  onerror?: (error: Error) => void;
  onclose?: () => void;

  constructor(private readonly sendHandler: (message: JSONRPCMessage) => void) {}

  async start(): Promise<void> {}

  async close(): Promise<void> {
    this.onclose?.();
  }

  async send(message: JSONRPCMessage): Promise<void> {
    this.sendHandler(message);
  }
}

export interface McpTestClient {
  close(): Promise<void>;
  listTools(): Promise<{ tools: Array<{ name: string }> }>;
  callTool(name: string, args?: Record<string, unknown>): Promise<any>;
}

export async function connectMcpTestClient(server: McpServer): Promise<McpTestClient> {
  const pending = new Map<number | string, { resolve: (value: any) => void; reject: (error: unknown) => void }>();
  let requestId = 1;

  const transport = new TestTransport((message: JSONRPCMessage) => {
    const json = message as any;
    if (json.id === undefined || !pending.has(json.id)) return;
    if (json.error) {
      pending.get(json.id)!.reject(json.error);
    } else {
      pending.get(json.id)!.resolve(json);
    }
    pending.delete(json.id);
  });

  await server.server.connect(transport);

  async function sendRequest(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = requestId++;
    const request = {
      jsonrpc: '2.0' as const,
      id,
      method,
      params: { ...params, _meta: { progressToken: id } },
    };

    return await new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      transport.onmessage?.(request);
    });
  }

  return {
    async close() {
      await transport.close();
      await server.close();
    },
    async listTools() {
      const response = await sendRequest('tools/list');
      return response.result;
    },
    async callTool(name: string, args: Record<string, unknown> = {}) {
      const response = await sendRequest('tools/call', { name, arguments: args });
      return response.result;
    },
  };
}

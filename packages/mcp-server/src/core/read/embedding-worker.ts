/**
 * Embedding Worker Thread
 *
 * Isolates @huggingface/transformers model loading and inference from the
 * main MCP server process. Communicates via structured messages over the
 * worker_threads parentPort.
 *
 * Message protocol:
 *   Main → Worker:
 *     { type: 'init', modelId: string }
 *     { type: 'embed', id: number, text: string }
 *     { type: 'shutdown' }
 *
 *   Worker → Main:
 *     { type: 'ready', dims: number }
 *     { type: 'result', id: number, embedding: Float32Array }
 *     { type: 'error', id: number?, message: string, fatal: boolean }
 */

import { parentPort } from 'node:worker_threads';

if (!parentPort) {
  throw new Error('embedding-worker.ts must be run as a worker thread');
}

const port = parentPort;

let pipeline: any = null;
let modelDims = 0;

/**
 * Load the HuggingFace transformer model with retry logic.
 */
async function loadModel(modelId: string): Promise<void> {
  const MAX_RETRIES = 3;
  const RETRY_DELAYS = [2000, 5000, 10000];

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Dynamic import — @huggingface/transformers is optional
      const transformers: any = await (Function('specifier', 'return import(specifier)')('@huggingface/transformers'));

      pipeline = await transformers.pipeline('feature-extraction', modelId, {
        dtype: 'fp32',
      });

      // Probe dimensions
      const probe = await pipeline('test', { pooling: 'mean', normalize: true });
      modelDims = probe.data.length;

      port.postMessage({ type: 'ready', dims: modelDims });
      return;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);

      // Missing dependency — no point retrying
      if (err instanceof Error && (
        errMsg.includes('Cannot find package') ||
        errMsg.includes('MODULE_NOT_FOUND') ||
        errMsg.includes('Cannot find module') ||
        errMsg.includes('ERR_MODULE_NOT_FOUND')
      )) {
        port.postMessage({
          type: 'error',
          message: 'Semantic search requires @huggingface/transformers. Install it with: npm install @huggingface/transformers',
          fatal: true,
        });
        return;
      }

      if (attempt < MAX_RETRIES) {
        const delay = RETRY_DELAYS[attempt - 1];
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        port.postMessage({
          type: 'error',
          message: `Model load failed after ${MAX_RETRIES} attempts: ${errMsg}`,
          fatal: true,
        });
      }
    }
  }
}

/**
 * Generate embedding for a single text.
 */
async function embed(id: number, text: string): Promise<void> {
  if (!pipeline) {
    port.postMessage({ type: 'error', id, message: 'Model not loaded', fatal: false });
    return;
  }

  try {
    const truncated = text.slice(0, 2000);
    const result = await pipeline(truncated, { pooling: 'mean', normalize: true });
    const embedding = new Float32Array(result.data);
    port.postMessage({ type: 'result', id, embedding }, [embedding.buffer]);
  } catch (err: unknown) {
    port.postMessage({
      type: 'error',
      id,
      message: err instanceof Error ? err.message : String(err),
      fatal: false,
    });
  }
}

// Message handler
port.on('message', (msg: any) => {
  switch (msg.type) {
    case 'init':
      loadModel(msg.modelId);
      break;
    case 'embed':
      embed(msg.id, msg.text);
      break;
    case 'shutdown':
      process.exit(0);
      break;
  }
});

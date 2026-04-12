import * as fs from 'fs';
import * as path from 'path';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

export interface EmbeddingProvider {
  init(): Promise<{ dims: number }>;
  embed(text: string): Promise<Float32Array>;
  shutdown(): void;
}

type PendingEmbed = {
  reject: (error: Error) => void;
  resolve: (embedding: Float32Array) => void;
};

/**
 * Worker-backed embedding provider.
 * Owns model loading, retry recovery, and request/response wiring so
 * callers can treat embeddings as a simple async dependency.
 */
export class WorkerEmbeddingProvider implements EmbeddingProvider {
  private initPromise: Promise<{ dims: number }> | null = null;
  private dims = 0;
  private nextRequestId = 0;
  private pending = new Map<number, PendingEmbed>();
  private ready = false;
  private worker: Worker | null = null;

  constructor(private readonly modelId: string) {}

  async init(): Promise<{ dims: number }> {
    if (this.ready && this.worker) {
      return { dims: this.dims };
    }
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = new Promise<{ dims: number }>((resolve, reject) => {
      try {
        const workerPath = resolveWorkerPath();
        console.error(`[Semantic] Spawning embedding worker: ${workerPath}`);

        this.worker = new Worker(workerPath);

        this.worker.on('message', (msg: any) => {
          switch (msg.type) {
            case 'ready':
              this.ready = true;
              this.dims = msg.dims;
              console.error(`[Semantic] Worker ready (model: ${this.modelId}, dims: ${msg.dims})`);
              resolve({ dims: msg.dims });
              break;

            case 'result': {
              const pending = this.pending.get(msg.id);
              if (pending) {
                this.pending.delete(msg.id);
                pending.resolve(new Float32Array(msg.embedding));
              }
              break;
            }

            case 'error': {
              if (msg.fatal) {
                console.error(`[Semantic] Worker fatal error: ${msg.message}`);
                console.error('[Semantic] Semantic search disabled. Keyword search (BM25) remains available.');
                this.shutdown();
                this.initPromise = null;
                reject(new Error(msg.message));
              } else if (msg.id != null) {
                const pending = this.pending.get(msg.id);
                if (pending) {
                  this.pending.delete(msg.id);
                  pending.reject(new Error(msg.message));
                }
              }
              break;
            }
          }
        });

        this.worker.on('error', (err) => {
          console.error(`[Semantic] Worker error: ${err.message}`);
          this.handleCrash(new Error(`Embedding worker error: ${err.message}`));
          if (!this.ready) {
            this.initPromise = null;
            reject(err);
          }
        });

        this.worker.on('exit', (code) => {
          if (code !== 0 && this.ready) {
            console.error(`[Semantic] Worker exited with code ${code}`);
            this.handleCrash(new Error(`Embedding worker exited with code ${code}`));
          }
        });

        this.worker.postMessage({ type: 'init', modelId: this.modelId });
      } catch (err) {
        this.initPromise = null;
        reject(err);
      }
    });

    return this.initPromise;
  }

  async embed(text: string): Promise<Float32Array> {
    await this.init();

    if (!this.worker) {
      throw new Error('Embedding worker not available');
    }

    const id = ++this.nextRequestId;
    return new Promise<Float32Array>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker!.postMessage({ type: 'embed', id, text });
    });
  }

  shutdown(): void {
    if (this.worker) {
      try {
        this.worker.postMessage({ type: 'shutdown' });
      } catch {
        // Worker is already gone.
      }
    }

    this.worker = null;
    this.ready = false;
    this.initPromise = null;
    this.dims = 0;
  }

  private handleCrash(error: Error): void {
    for (const [id, pending] of this.pending) {
      pending.reject(error);
      this.pending.delete(id);
    }
    this.worker = null;
    this.ready = false;
    this.initPromise = null;
  }
}

let provider: EmbeddingProvider | null = null;
let providerModelId: string | null = null;

function resolveWorkerPath(): string {
  const thisFile = typeof __filename !== 'undefined'
    ? __filename
    : fileURLToPath(import.meta.url);
  const thisDir = path.dirname(thisFile);

  const workerPath = path.join(thisDir, 'embedding-worker.js');
  if (fs.existsSync(workerPath)) return workerPath;

  const devPath = path.resolve(thisDir, '..', '..', '..', 'dist', 'embedding-worker.js');
  if (fs.existsSync(devPath)) return devPath;

  throw new Error(
    `Embedding worker not found at ${workerPath}. Run 'npm run build' to generate it.`
  );
}

export function getEmbeddingProvider(modelId: string): EmbeddingProvider {
  if (provider && providerModelId !== modelId) {
    provider.shutdown();
    provider = null;
    providerModelId = null;
  }
  if (!provider) {
    provider = new WorkerEmbeddingProvider(modelId);
    providerModelId = modelId;
  }
  return provider;
}

export function resetEmbeddingProvider(): void {
  provider?.shutdown();
  provider = null;
  providerModelId = null;
}

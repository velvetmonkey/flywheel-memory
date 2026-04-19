import * as fs from 'fs';
import * as path from 'path';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

export interface EmbeddingProvider {
  init(): Promise<{ dims: number }>;
  embed(text: string): Promise<Float32Array>;
  shutdown(reason?: string): void;
}

type PendingEmbed = {
  reject: (error: Error) => void;
  resolve: (embedding: Float32Array) => void;
};

export class EmbeddingProviderShutdownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbeddingProviderShutdownError';
  }
}

/**
 * Worker-backed embedding provider.
 * Owns model loading, retry recovery, and request/response wiring so
 * callers can treat embeddings as a simple async dependency.
 */
export class WorkerEmbeddingProvider implements EmbeddingProvider {
  private initPromise: Promise<{ dims: number }> | null = null;
  private initReject: ((error: Error) => void) | null = null;
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
      this.initReject = reject;

      try {
        const workerPath = resolveWorkerPath();
        console.error(`[Semantic] Spawning embedding worker: ${workerPath}`);

        const worker = new Worker(workerPath);
        this.worker = worker;

        worker.on('message', (msg: any) => {
          if (this.worker !== worker) return;

          switch (msg.type) {
            case 'ready':
              this.ready = true;
              this.dims = msg.dims;
              this.initReject = null;
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
                this.handleCrash(new Error(msg.message));
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

        worker.on('error', (err) => {
          if (this.worker !== worker) return;

          console.error(`[Semantic] Worker error: ${err.message}`);
          this.handleCrash(new Error(`Embedding worker error: ${err.message}`));
        });

        worker.on('exit', (code) => {
          if (this.worker !== worker) return;

          if (code !== 0) {
            console.error(`[Semantic] Worker exited with code ${code}`);
            this.handleCrash(new Error(`Embedding worker exited with code ${code}`));
            return;
          }

          if (!this.ready) {
            this.handleCrash(new Error('Embedding worker exited before ready'));
          }
        });

        worker.postMessage({ type: 'init', modelId: this.modelId });
      } catch (err) {
        this.initReject = null;
        this.initPromise = null;
        reject(err);
      }
    });

    return this.initPromise;
  }

  async embed(text: string): Promise<Float32Array> {
    if (!this.ready) {
      await this.init();
    }

    if (!this.worker) {
      throw new EmbeddingProviderShutdownError(
        'Embedding provider shut down before the embed request could be sent'
      );
    }

    const id = ++this.nextRequestId;
    const worker = this.worker;
    return new Promise<Float32Array>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        worker.postMessage({ type: 'embed', id, text });
      } catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  shutdown(reason: string = 'shutdown'): void {
    const error = new EmbeddingProviderShutdownError(
      `Embedding provider shut down (${reason})`
    );
    const worker = this.worker;
    this.handleCrash(error);

    if (worker) {
      try {
        worker.postMessage({ type: 'shutdown' });
      } catch {
        // Worker is already gone.
      }
      void worker.terminate().catch(() => {
        // Worker is already gone.
      });
    }
  }

  private handleCrash(error: Error): void {
    this.rejectPending(error);
    this.rejectInit(error);
    this.worker = null;
    this.ready = false;
    this.initPromise = null;
    this.dims = 0;
  }

  private rejectPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  private rejectInit(error: Error): void {
    if (!this.initReject) return;
    const reject = this.initReject;
    this.initReject = null;
    reject(error);
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
    provider.shutdown('model switch');
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
  provider?.shutdown('reset');
  provider = null;
  providerModelId = null;
}

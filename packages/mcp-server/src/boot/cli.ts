/**
 * CLI: --init-semantic pre-warm command (arch-review S10 — extracted
 * verbatim from index.ts). Invoked by index.ts instead of main() when
 * --init-semantic is on argv.
 */

import { openStateDb } from '@velvetmonkey/vault-core';
import {
  setEmbeddingsDatabase,
  buildEmbeddingsIndex,
  setEmbeddingsBuildState,
  getStoredEmbeddingModel,
  getActiveModelId,
  clearEmbeddingsForRebuild,
} from './../core/read/embeddings.js';
import { findVaultRoot } from './../core/read/vaultRoot.js';
import { parseVaultConfig } from './../vault-registry.js';

export function runInitSemanticCli(): void {
  (async () => {
    // Resolve vault path locally (module-level vaultPath is set in main(), which doesn't run for --init-semantic)
    const semanticVaultConfigs = parseVaultConfig();
    const semanticVaultPath = semanticVaultConfigs
      ? semanticVaultConfigs[0].path
      : (process.env.PROJECT_PATH || process.env.VAULT_PATH || process.env.OBSIDIAN_VAULT || findVaultRoot());

    console.error('[Semantic] Pre-warming semantic search...');
    console.error(`[Semantic] Vault: ${semanticVaultPath}`);

    try {
      const db = openStateDb(semanticVaultPath);
      setEmbeddingsDatabase(db.db);

      // Model change → full clear
      const storedModel = getStoredEmbeddingModel();
      if (storedModel && storedModel !== getActiveModelId()) {
        console.error(`[Semantic] Model changed ${storedModel} → ${getActiveModelId()}, clearing`);
        clearEmbeddingsForRebuild();
      }

      const progress = await buildEmbeddingsIndex(semanticVaultPath, (p) => {
        if (p.current % 50 === 0 || p.current === p.total) {
          console.error(`[Semantic] Embedding ${p.current}/${p.total} notes (${p.skipped} skipped)...`);
        }
      });

      console.error(`[Semantic] Done. Embedded ${progress.total - progress.skipped} notes, skipped ${progress.skipped}.`);
      setEmbeddingsBuildState('complete');
      db.close();
      process.exit(0);
    } catch (err) {
      console.error('[Semantic] Failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  })();
}

/**
 * Generate tool embeddings manifest.
 *
 * Run: npm run generate:tool-embeddings
 *
 * Collects all tool descriptions via the catalog collector, embeds each using
 * the default model (Xenova/all-MiniLM-L6-v2), and writes a checked-in
 * TypeScript manifest at src/generated/tool-embeddings.generated.ts.
 *
 * Skips regeneration when the catalog sourceHash matches the existing manifest.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { collectToolCatalog, getCatalogSourceHash, type CatalogEntry } from '../src/tools/toolCatalog.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MANIFEST_PATH = join(__dirname, '../src/generated/tool-embeddings.generated.ts');
const DEFAULT_MODEL = 'Xenova/all-MiniLM-L6-v2';
const DEFAULT_DIMS = 384;
const MANIFEST_VERSION = 1;

interface ManifestToolEntry {
  name: string;
  category: string;
  tier: number;
  descriptionHash: string;
  embedding: number[];
}

interface Manifest {
  model: string;
  dims: number;
  version: number;
  generatedAt: string;
  sourceHash: string;
  tools: ManifestToolEntry[];
}

/** Read sourceHash from existing manifest file, if it exists. */
function getExistingSourceHash(): string | null {
  if (!existsSync(MANIFEST_PATH)) return null;
  try {
    const content = readFileSync(MANIFEST_PATH, 'utf-8');
    const match = content.match(/sourceHash:\s*'([a-f0-9]+)'/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/** Build canonical routing text for a tool. */
function buildRoutingText(entry: CatalogEntry): string {
  return `${entry.name} | ${entry.category} | tier ${entry.tier} | ${entry.description}`;
}

/** Write the manifest as a TypeScript file. */
function writeManifest(manifest: Manifest): void {
  const toolEntries = manifest.tools
    .map((t) => {
      const embStr = `[${t.embedding.map((v) => v.toFixed(6)).join(',')}]`;
      return `    { name: '${t.name}', category: '${t.category}', tier: ${t.tier}, descriptionHash: '${t.descriptionHash}', embedding: ${embStr} }`;
    })
    .join(',\n');

  const content = `/**
 * AUTO-GENERATED — do not edit manually.
 * Run: npm run generate:tool-embeddings
 *
 * Model: ${manifest.model}
 * Dims: ${manifest.dims}
 * Tools: ${manifest.tools.length}
 * Generated: ${manifest.generatedAt}
 */

/* eslint-disable */
// prettier-ignore
export const TOOL_EMBEDDINGS_MANIFEST = {
  model: '${manifest.model}',
  dims: ${manifest.dims},
  version: ${manifest.version},
  generatedAt: '${manifest.generatedAt}',
  sourceHash: '${manifest.sourceHash}',
  tools: [
${toolEntries},
  ],
} as const;

export type ToolEmbeddingEntry = (typeof TOOL_EMBEDDINGS_MANIFEST)['tools'][number];
`;

  writeFileSync(MANIFEST_PATH, content, 'utf-8');
}

async function main(): Promise<void> {
  console.log('Collecting tool catalog...');
  const catalog = collectToolCatalog();
  console.log(`  ${catalog.size} tools collected`);

  const sourceHash = getCatalogSourceHash(catalog);
  console.log(`  sourceHash: ${sourceHash}`);

  // Check if regeneration is needed
  const existingHash = getExistingSourceHash();
  if (existingHash === sourceHash) {
    console.log('  Manifest is up-to-date — skipping regeneration.');
    return;
  }

  if (existingHash) {
    console.log(`  Existing hash: ${existingHash} — regenerating.`);
  } else {
    console.log('  No existing manifest — generating.');
  }

  // Lazy-import embeddings to trigger model download only when needed
  const { embedText, initEmbeddings, getActiveModelId } = await import(
    '../src/core/read/embeddings.js'
  );

  console.log(`Initializing embedding model (${DEFAULT_MODEL})...`);
  await initEmbeddings();

  const activeModel = getActiveModelId();
  if (activeModel !== DEFAULT_MODEL) {
    console.error(
      `ERROR: Active model is '${activeModel}' but manifest requires '${DEFAULT_MODEL}'.` +
        ` Unset EMBEDDING_MODEL env var and retry.`,
    );
    process.exit(1);
  }

  const entries = Array.from(catalog.values()).sort((a, b) => a.name.localeCompare(b.name));
  const toolEntries: ManifestToolEntry[] = [];

  console.log(`Embedding ${entries.length} tool descriptions...`);
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const routingText = buildRoutingText(entry);
    const embedding = await embedText(routingText);

    if (embedding.length !== DEFAULT_DIMS) {
      throw new Error(
        `Expected ${DEFAULT_DIMS} dims, got ${embedding.length} for tool '${entry.name}'`,
      );
    }

    toolEntries.push({
      name: entry.name,
      category: entry.category,
      tier: entry.tier,
      descriptionHash: entry.descriptionHash,
      embedding: Array.from(embedding),
    });

    if ((i + 1) % 10 === 0 || i === entries.length - 1) {
      console.log(`  ${i + 1}/${entries.length}`);
    }
  }

  const manifest: Manifest = {
    model: DEFAULT_MODEL,
    dims: DEFAULT_DIMS,
    version: MANIFEST_VERSION,
    generatedAt: new Date().toISOString(),
    sourceHash,
    tools: toolEntries,
  };

  writeManifest(manifest);
  console.log(`Manifest written to ${MANIFEST_PATH}`);
  console.log(`  ${manifest.tools.length} tools, ${manifest.dims} dims, model: ${manifest.model}`);
}

main().catch((err) => {
  console.error('Failed to generate tool embeddings:', err);
  process.exit(1);
});

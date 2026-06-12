/**
 * Embedding health diagnosis — read-only SQLite checks over the note and
 * entity embedding tables (arch-review S8).
 * Extracted verbatim from core/read/embeddings.ts.
 */

import {
  activeModelConfig,
  getDb,
  getStoredEmbeddingModel,
  getStoredTextVersion,
  EMBEDDING_TEXT_VERSION,
} from './runtime.js';

export interface EmbeddingCheck {
  name: string;
  status: 'ok' | 'stale' | 'warning';
  detail: string;
}

export interface EmbeddingDiagnosis {
  healthy: boolean;
  checks: EmbeddingCheck[];
  counts: {
    embedded: number;
    vaultNotes: number;
    orphaned: number;
    orphanedEntities: number;
    missing: number;
  };
}

/**
 * Read-only diagnostic: check all aspects of embedding health.
 * All SQLite reads, no disk I/O, no model loading. <10ms.
 */
export function diagnoseEmbeddings(vaultPath: string): EmbeddingDiagnosis {
  const db = getDb();
  const checks: EmbeddingCheck[] = [];
  const counts = { embedded: 0, vaultNotes: 0, orphaned: 0, orphanedEntities: 0, missing: 0 };

  if (!db) {
    checks.push({ name: 'database', status: 'stale', detail: 'No database available' });
    return { healthy: false, checks, counts };
  }

  // Count embeddings
  try {
    const row = db.prepare('SELECT COUNT(*) as count FROM note_embeddings').get() as { count: number };
    counts.embedded = row.count;
  } catch { /* table may not exist */ }

  if (counts.embedded === 0) {
    checks.push({ name: 'index', status: 'stale', detail: 'No embeddings built' });
    return { healthy: false, checks, counts };
  }

  // Check 1: Model consistency
  const storedModel = getStoredEmbeddingModel();
  if (storedModel && storedModel !== activeModelConfig.id) {
    checks.push({ name: 'model', status: 'stale', detail: `${storedModel} → ${activeModelConfig.id}` });
  } else {
    checks.push({ name: 'model', status: 'ok', detail: storedModel || activeModelConfig.id });
  }

  // Check 2: Text version
  const storedVersion = getStoredTextVersion();
  if (storedVersion !== null && storedVersion !== EMBEDDING_TEXT_VERSION) {
    checks.push({ name: 'text_version', status: 'stale', detail: `v${storedVersion} → v${EMBEDDING_TEXT_VERSION}` });
  } else if (storedVersion === null) {
    checks.push({ name: 'text_version', status: 'warning', detail: 'No version stored (pre-migration)' });
  } else {
    checks.push({ name: 'text_version', status: 'ok', detail: `v${storedVersion}` });
  }

  // Check 3: Dimension sanity (skip if dims unknown)
  if (activeModelConfig.dims > 0) {
    try {
      const sample = db.prepare('SELECT embedding FROM note_embeddings LIMIT 1').get() as { embedding: Buffer } | undefined;
      if (sample) {
        const storedDims = sample.embedding.byteLength / Float32Array.BYTES_PER_ELEMENT;
        if (storedDims !== activeModelConfig.dims) {
          checks.push({ name: 'dimensions', status: 'stale', detail: `stored=${storedDims}, expected=${activeModelConfig.dims}` });
        } else {
          checks.push({ name: 'dimensions', status: 'ok', detail: `${storedDims}` });
        }
      }
    } catch {
      checks.push({ name: 'dimensions', status: 'warning', detail: 'Could not sample' });
    }
  }

  // Check 4: Completeness (embedded vs vault notes via notes_fts)
  try {
    const ftsRow = db.prepare('SELECT COUNT(*) as count FROM notes_fts').get() as { count: number };
    counts.vaultNotes = ftsRow.count;
    counts.missing = Math.max(0, counts.vaultNotes - counts.embedded);
    if (counts.missing > 0) {
      checks.push({ name: 'completeness', status: 'warning', detail: `${counts.embedded}/${counts.vaultNotes} notes embedded (${counts.missing} missing)` });
    } else {
      checks.push({ name: 'completeness', status: 'ok', detail: `${counts.embedded}/${counts.vaultNotes} notes` });
    }
  } catch {
    checks.push({ name: 'completeness', status: 'warning', detail: 'FTS5 index not available' });
  }

  // Check 5: Orphans (embeddings for deleted notes)
  try {
    const embPaths = new Set(
      (db.prepare('SELECT path FROM note_embeddings').all() as Array<{ path: string }>).map(r => r.path)
    );
    const ftsPaths = new Set(
      (db.prepare('SELECT path FROM notes_fts').all() as Array<{ path: string }>).map(r => r.path)
    );
    counts.orphaned = 0;
    for (const p of embPaths) {
      if (!ftsPaths.has(p)) counts.orphaned++;
    }
    if (counts.orphaned > 0) {
      checks.push({ name: 'orphans', status: 'warning', detail: `${counts.orphaned} orphaned embeddings` });
    } else {
      checks.push({ name: 'orphans', status: 'ok', detail: '0 orphaned' });
    }
  } catch {
    checks.push({ name: 'orphans', status: 'warning', detail: 'Could not check' });
  }

  // Check 5b: Entity embedding orphans
  try {
    const embNames = new Set(
      (db.prepare('SELECT entity_name FROM entity_embeddings').all() as Array<{ entity_name: string }>).map(r => r.entity_name)
    );
    const entityNames = new Set(
      (db.prepare('SELECT name FROM entities').all() as Array<{ name: string }>).map(r => r.name)
    );
    counts.orphanedEntities = 0;
    for (const n of embNames) {
      if (!entityNames.has(n)) counts.orphanedEntities++;
    }
    if (counts.orphanedEntities > 0) {
      checks.push({ name: 'entity_orphans', status: 'warning', detail: `${counts.orphanedEntities} orphaned entity embeddings` });
    } else {
      checks.push({ name: 'entity_orphans', status: 'ok', detail: '0 orphaned' });
    }
  } catch (e) {
    const msg = String(e);
    if (msg.includes('no such table')) {
      checks.push({ name: 'entity_orphans', status: 'ok', detail: 'No entity embeddings table' });
    } else {
      checks.push({ name: 'entity_orphans', status: 'warning', detail: 'Could not check entity orphans' });
    }
  }

  // Check 6: Integrity (NaN/Inf sample)
  try {
    const samples = db.prepare('SELECT embedding FROM note_embeddings ORDER BY RANDOM() LIMIT 3').all() as Array<{ embedding: Buffer }>;
    let corrupt = false;
    for (const s of samples) {
      const arr = new Float32Array(s.embedding.buffer, s.embedding.byteOffset, s.embedding.byteLength / Float32Array.BYTES_PER_ELEMENT);
      for (let i = 0; i < arr.length; i++) {
        if (!isFinite(arr[i])) { corrupt = true; break; }
      }
      if (corrupt) break;
    }
    checks.push({ name: 'integrity', status: corrupt ? 'stale' : 'ok', detail: corrupt ? 'Corrupted vectors detected' : 'No corruption' });
  } catch {
    checks.push({ name: 'integrity', status: 'warning', detail: 'Could not sample' });
  }

  const healthy = checks.every(c => c.status === 'ok' || c.status === 'warning');
  return { healthy, checks, counts };
}

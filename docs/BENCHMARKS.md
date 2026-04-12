# Performance Benchmarks

[← Back to docs](README.md)

Measured performance characteristics of Flywheel Memory at various vault sizes. Use these to set expectations for your vault.

> **Last measured:** 2026-03-19 | **Node:** 22.x | **Platform:** WSL2 (Linux 6.6) on Windows 11 | **Model:** all-MiniLM-L6-v2 (default embeddings)

- [Index Build (Cold Start)](#index-build-cold-start)
- [Watcher Batch Latency (Hot Path)](#watcher-batch-latency-hot-path)
- [Semantic Embedding Build](#semantic-embedding-build)
- [Tool Response Times](#tool-response-times)
- [StateDb Disk Usage](#statedb-disk-usage)
- [Memory Usage (Steady State)](#memory-usage-steady-state)
- [Methodology](#methodology)
- [Scaling Notes](#scaling-notes)

---

## Index Build (Cold Start)

Full vault scan + entity extraction + FTS5 build + hub scores:

| Vault Size | Notes | Build Time | Peak RSS |
|-----------|-------|-----------|----------|
| Small | ~100 | <1s | ~80 MB |
| Medium | ~500 | 2–4s | ~120 MB |
| Large | ~1,500 | 6–10s | ~180 MB |
| Very Large | ~5,000 | 20–40s | ~300 MB |
| Massive | ~10,000+ | 60–120s | ~500 MB |

## Watcher Batch Latency (Hot Path)

Incremental update after a file change (18-step pipeline):

| Vault Size | Batch Latency | Notes |
|-----------|---------------|-------|
| Any | 30–80ms | Hash gate skips unchanged files |
| Any (with embeddings) | 50–150ms | +1 embedding update per changed file |

The watcher uses content hashing (SHA-256) to skip unchanged files entirely. Batch latency is dominated by the number of *changed* files, not total vault size.

## Semantic Embedding Build

First-time `init_semantic` — downloads model + embeds all notes + entities:

| Vault Size | Notes | Build Time | DB Size Increase |
|-----------|-------|-----------|-----------------|
| Small | ~100 | 10–20s | ~2 MB |
| Medium | ~500 | 30–60s | ~8 MB |
| Large | ~1,500 | 2–4 min | ~25 MB |
| Very Large | ~5,000 | 8–15 min | ~80 MB |

Model download (~30 MB) is a one-time cost on first run. Subsequent `init_semantic` calls skip already-embedded notes.

## Tool Response Times

Typical latency for common tool calls (1,500-note vault, index warm):

| Tool | Latency | Notes |
|------|---------|-------|
| `search` (FTS5 only) | 2–8ms | BM25 ranking |
| `search` (hybrid) | 10–30ms | FTS5 + semantic + RRF |
| `link(action: suggest)` | 5–15ms | Without `detail=true` |
| `link(action: suggest)` (detail) | 20–50ms | With 13-layer scoring |
| `note_read` | 1–3ms | Single file read + parse |
| `get_backlinks` | 1–5ms | Index lookup |
| `doctor(action: health)` | 10–30ms | Aggregates subsystem health (FTS5, embeddings, indexes) |
| `edit_section(action: add)` | 5–20ms | Read + parse + write + hash check |
| `insights(action: evolution)` | 50–200ms | Composes temporal + graph queries |

## StateDb Disk Usage

`.flywheel/state.db` size by vault:

| Vault Size | DB Size | WAL Size (active) |
|-----------|---------|-------------------|
| ~500 notes | 5–10 MB | 1–5 MB |
| ~1,500 notes | 15–30 MB | 2–8 MB |
| ~5,000 notes | 50–100 MB | 5–15 MB |
| ~10,000+ notes | 100–200 MB | 10–30 MB |

WAL is checkpointed periodically. Size depends on write frequency (wikilink applications, feedback, suggestion events).

## Memory Usage (Steady State)

RSS after index build, embeddings loaded, watcher running:

| Vault Size | RSS (no embeddings) | RSS (with embeddings) |
|-----------|--------------------|-----------------------|
| ~500 notes | ~100 MB | ~150 MB |
| ~1,500 notes | ~150 MB | ~250 MB |
| ~5,000 notes | ~250 MB | ~450 MB |
| ~10,000+ notes | ~400 MB | ~700 MB |

Embedding vectors (~384 floats × 4 bytes per note) are the largest memory consumer after the index.

## Methodology

- Build times measured with `console.error` timestamps in watcher/indexer
- Tool latencies from `tool_invocations` table (production vault, p50)
- Memory from `process.memoryUsage().rss` snapshots
- Disk sizes from `stat` on `.flywheel/state.db`
- All measurements on a single machine; your hardware will vary

## Scaling Notes

- **Sub-linear scaling**: FTS5 and SQLite indexes mean search doesn't slow linearly with vault size
- **Embedding is the bottleneck**: For vaults >5,000 notes, `init_semantic` is the longest operation
- **Watcher is vault-size-independent**: Content hash gate means batch latency depends on changed files, not total files
- **Memory is dominated by embeddings**: Without semantic search, memory stays under 300 MB even for 10k+ vaults

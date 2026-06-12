/**
 * Pipeline Activity (process-local runtime status) — arch-review S9,
 * moved from core/read/watch/pipeline.ts.
 *
 * The PipelineActivity TYPE stays in core/read/watch/types.ts (leaf module);
 * this module owns the runtime constant and factory.
 */

import type { PipelineActivity } from '../../read/watch/types.js';

/**
 * Canonical ordered roster of every step a single watcher batch can fire
 * (branch-exclusive tracker.start variants share one name and appear once;
 * execution order matches PipelineRunner.run()).
 *
 * SINGLE SOURCE OF TRUTH for the progress denominator shown by
 * doctor(action: pipeline) — PIPELINE_TOTAL_STEPS derives from this
 * roster's length, and test/read/watch/pipeline-step-roster.test.ts
 * verifies the roster against both a real batch run and a source scan of
 * the step modules, so the count can never silently desync again (D1).
 *
 * `proactive_enqueue` is the one conditional step: it appends a tracker
 * entry only when suggestion_scoring produced candidates, so batches may
 * legitimately complete at total-1.
 */
export const PIPELINE_STEPS = [
  'drain_proactive_queue',
  'index_rebuild',
  'fts5_incremental',
  'note_moves',
  'entity_scan',
  'hub_scores',
  'recency',
  'cooccurrence',
  'edge_weights',
  'note_embeddings',
  'entity_embeddings',
  'index_cache',
  'task_cache',
  'forward_links',
  'wikilink_check',
  'implicit_feedback',
  'incremental_recency',
  'corrections',
  'prospect_scan',
  'suggestion_scoring',
  'proactive_enqueue',
  'tag_scan',
  'retrieval_cooccurrence',
  'integrity_check',
  'maintenance',
] as const;

/** Total number of steps in the pipeline (used for progress reporting) — derived, never hand-edited. */
export const PIPELINE_TOTAL_STEPS = PIPELINE_STEPS.length;

export type { PipelineActivity } from '../../read/watch/types.js';

export function createEmptyPipelineActivity(): PipelineActivity {
  return {
    busy: false,
    trigger: null,
    started_at: null,
    current_step: null,
    completed_steps: 0,
    total_steps: PIPELINE_TOTAL_STEPS,
    pending_events: 0,
    last_completed_at: null,
    last_completed_trigger: null,
    last_completed_duration_ms: null,
    last_completed_files: null,
    last_completed_steps: [],
  };
}

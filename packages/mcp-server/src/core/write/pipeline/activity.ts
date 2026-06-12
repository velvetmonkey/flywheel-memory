/**
 * Pipeline Activity (process-local runtime status) — arch-review S9,
 * moved from core/read/watch/pipeline.ts.
 *
 * The PipelineActivity TYPE stays in core/read/watch/types.ts (leaf module);
 * this module owns the runtime constant and factory.
 */

import type { PipelineActivity } from '../../read/watch/types.js';

/** Total number of steps in the pipeline (used for progress reporting) */
export const PIPELINE_TOTAL_STEPS = 22;

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

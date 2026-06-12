/**
 * Output types for the diagnostics surface (arch-review S7).
 */

import type { IndexState } from '../read/types.js';
import type { CompactStep, CompactPipelineRun } from '../shared/indexActivity.js';
import type { SweepResults } from '../read/sweep.js';

export type PeriodicNoteInfo = {
  type: string;
  detected: boolean;
  folder: string | null;
  pattern: string | null;
  today_path: string | null;
  today_exists: boolean;
};

export type HealthCheckOutput = {
  status: 'healthy' | 'degraded' | 'unhealthy';
  vault_health_score: number;
  schema_version: number;
  vault_accessible: boolean;
  vault_path: string;
  index_state: IndexState;
  index_progress?: { parsed: number; total: number };
  index_error?: string;
  index_built: boolean;
  index_age_seconds: number;
  index_stale: boolean;
  note_count: number;
  entity_count: number;
  tag_count: number;
  link_count: number;
  periodic_notes?: PeriodicNoteInfo[];
  config?: Record<string, unknown>;
  last_rebuild?: {
    trigger: string;
    timestamp: number;
    duration_ms: number;
    ago_seconds: number;
  };
  last_pipeline?: {
    timestamp: number;
    trigger: string;
    duration_ms: number;
    files_changed: number | null;
    changed_paths_total: number;
    changed_paths_sample: string[];
    step_count: number;
    steps?: CompactStep[];
  };
  recent_pipelines?: CompactPipelineRun[];
  fts5_ready: boolean;
  fts5_building: boolean;
  embeddings_building: boolean;
  embeddings_ready: boolean;
  embeddings_count: number;
  last_embedding_build?: Record<string, unknown>;
  embedding_model?: string;
  embedding_diagnosis?: {
    healthy: boolean;
    checks: Array<{ name: string; status: 'ok' | 'stale' | 'warning'; detail: string }>;
    counts: { embedded: number; vaultNotes: number; orphaned: number; missing: number };
  };
  tasks_ready: boolean;
  tasks_building: boolean;
  watcher_state?: 'starting' | 'ready' | 'rebuilding' | 'dirty' | 'error';
  boot_state: string;
  integrity_state: string;
  integrity_check_in_progress: boolean;
  integrity_started_at: number | null;
  integrity_source: string | null;
  integrity_last_checked_at: number | null;
  integrity_duration_ms: number | null;
  integrity_detail: string | null;
  watcher_pending?: number;
  last_index_activity_at?: number;
  last_index_activity_ago_seconds?: number;
  last_full_rebuild_at?: number;
  last_watcher_batch_at?: number;
  pipeline_activity?: {
    busy: boolean;
    current_step: string | null;
    started_at: number | null;
    progress: string | null;
    last_completed_ago_seconds: number | null;
  };
  dead_link_count?: number;
  top_dead_link_targets?: Array<{ target: string; mention_count: number }>;
  sweep?: SweepResults;
  proactive_linking?: {
    enabled: boolean;
    queue_pending: number;
    summary: string | null;
    total_applied_24h: number;
    survived_24h: number;
    removed_24h: number;
    files_24h: number;
  };
  recommendations: string[];
};

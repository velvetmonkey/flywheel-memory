/**
 * Flywheel Bench - Shared Types
 */

// =============================================================================
// Vault Generator Types
// =============================================================================

export interface VaultConfig {
  /** Output directory for generated vault */
  outputDir: string;
  /** Number of notes to generate */
  noteCount: number;
  /** Average wikilinks per note */
  avgLinksPerNote: number;
  /** Entity types to generate */
  entityTypes: EntityType[];
  /** Count per entity type */
  entityCount: Record<EntityType, number>;
  /** Maximum folder nesting depth */
  folderDepth: number;
  /** Average note content length in characters */
  avgNoteLength: number;
  /** Probability a note has frontmatter (0-1) */
  frontmatterProbability: number;
  /** Random seed for reproducibility */
  seed: number;
  /** Initialize as git repository */
  initGit?: boolean;
}

export type EntityType = 'person' | 'project' | 'topic' | 'location' | 'company';

export interface GeneratedVault {
  path: string;
  noteCount: number;
  entityCount: number;
  totalLinks: number;
  folderCount: number;
  seed: number;
  generatedAt: string;
}

export interface GeneratedNote {
  path: string;
  title: string;
  content: string;
  frontmatter?: Record<string, unknown>;
  wikilinks: string[];
  folder: string;
}

export interface GeneratedEntity {
  name: string;
  type: EntityType;
  aliases?: string[];
}

// =============================================================================
// Benchmark Types
// =============================================================================

export interface BenchmarkConfig {
  /** Vault sizes to test */
  vaultSizes: number[];
  /** Output directory for results */
  outputDir: string;
  /** Baseline file for regression comparison */
  baseline?: string;
  /** Warmup iterations before measurement */
  warmupIterations?: number;
  /** Measurement iterations */
  iterations?: number;
}

export interface BenchmarkSuite {
  name: string;
  fn: (vaultPath: string, size: number) => Promise<void>;
  /** Optional setup before benchmark */
  setup?: (vaultPath: string) => Promise<void>;
  /** Optional teardown after benchmark */
  teardown?: (vaultPath: string) => Promise<void>;
}

export interface BenchmarkResult {
  timestamp: string;
  commit: string;
  nodeVersion: string;
  platform: string;
  scales: Record<string, ScaleResult>;
  regressions: Regression[];
}

export interface ScaleResult {
  [benchmarkName: string]: BenchmarkMetrics;
}

export interface BenchmarkMetrics {
  mean_ms: number;
  min_ms: number;
  max_ms: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  std_dev: number;
  memory_mb: number;
  iterations: number;
}

export interface Regression {
  benchmark: string;
  scale: number;
  metric: string;
  baseline: number;
  current: number;
  change_percent: number;
  threshold_percent: number;
}

// =============================================================================
// Iteration Testing Types
// =============================================================================

export interface StressTestConfig {
  /** Path to vault */
  vaultPath: string;
  /** Number of mutations to perform */
  mutationCount: number;
  /** Mutation distribution */
  distribution: MutationDistribution;
  /** Check interval for integrity */
  checkInterval: number;
  /** Enable detailed logging */
  verbose?: boolean;
}

export interface MutationDistribution {
  add_to_section: number;
  toggle_task: number;
  update_frontmatter: number;
  create_note: number;
  delete_note: number;
}

export interface StressTestResult {
  totalMutations: number;
  successfulMutations: number;
  failedMutations: number;
  integrityChecks: IntegrityCheckResult[];
  performanceTimeline: PerformanceSnapshot[];
  gitHealth: GitHealthResult;
  duration_ms: number;
}

export interface IntegrityCheckResult {
  iteration: number;
  timestamp: string;
  noteCount: number;
  entityCount: number;
  orphanedLinks: number;
  corrupted: boolean;
  errors: string[];
}

export interface PerformanceSnapshot {
  iteration: number;
  timestamp: string;
  mutation_latency_ms: number;
  memory_mb: number;
  heap_used_mb: number;
}

export interface GitHealthResult {
  totalObjects: number;
  looseObjects: number;
  packedObjects: number;
  totalSize_mb: number;
  isHealthy: boolean;
  issues: string[];
}

// =============================================================================
// Logging Types
// =============================================================================

export interface LoggingConfig {
  /** Enable operation logging */
  enabled: boolean;
  /** Path to log file */
  logPath: string;
  /** Log rotation settings */
  rotation?: {
    maxSize_mb: number;
    maxFiles: number;
  };
  /** Privacy settings */
  privacy?: {
    logNoteTitles: boolean;
    logContent: boolean;
  };
}

export interface OperationLog {
  timestamp: string;
  tool: string;
  vault: string;
  duration_ms: number;
  entities_scanned?: number;
  notes_affected?: number;
  success: boolean;
  error?: string;
}

export interface AggregatedMetrics {
  period: {
    start: string;
    end: string;
  };
  operations: {
    total: number;
    successful: number;
    failed: number;
  };
  timing: {
    mean_ms: number;
    p50_ms: number;
    p95_ms: number;
    p99_ms: number;
  };
  byTool: Record<string, ToolMetrics>;
}

export interface ToolMetrics {
  count: number;
  success_rate: number;
  mean_ms: number;
  p95_ms: number;
}

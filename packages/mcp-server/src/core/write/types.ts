/**
 * Content hash for change tracking
 */
export interface ContentHash {
  /** Hash of content before mutation */
  before: string;
  /** Hash of content after mutation */
  after: string;
}

export interface MutationResult {
  success: boolean;
  message: string;
  path: string;
  preview?: string;
  gitCommit?: string;
  /** Content hashes for change tracking (optional) */
  contentHash?: ContentHash;
  /** Whether a hint was written for Flywheel integration */
  hintWritten?: boolean;
  /** Estimated token count for this response (helps track API costs) */
  tokensEstimate?: number;
  /** Input validation warnings (when validate: true) */
  warnings?: ValidationWarning[];
  /** Output guardrail issues (when guardrails: 'warn') */
  outputIssues?: OutputIssue[];
  /** Normalization changes applied (when normalize: true) */
  normalizationChanges?: string[];
  /** True only if commit succeeded and undo is available */
  undoAvailable?: boolean;
  /** True if a stale lock (>30s old) was detected during retries */
  staleLockDetected?: boolean;
  /** Age of the lock file in milliseconds (if detected) */
  lockAgeMs?: number;
  /** Structured diagnostic information for debugging failed mutations */
  diagnostic?: Record<string, unknown>;
}

/** Warning from input validation */
export interface ValidationWarning {
  type: string;
  message: string;
  suggestion: string;
}

/** Issue detected by output guardrails */
export interface OutputIssue {
  type: string;
  severity: 'error' | 'warning';
  message: string;
  line?: number;
}

export interface SectionInfo {
  name: string;
  level: number;
  lineStart: number;
  lineEnd: number;
}

export type FormatType = 'task' | 'bullet' | 'numbered' | 'plain' | 'timestamp-bullet';
export type Position = 'append' | 'prepend';

export interface InsertionOptions {
  preserveListNesting?: boolean;
  bumpHeadings?: boolean;
}

/**
 * Strictness mode for wikilink suggestions
 *
 * - 'conservative': High precision, fewer suggestions (default)
 *   Best for: Production use, avoiding false positives
 *
 * - 'balanced': Moderate precision, more suggestions
 *   Best for: Interactive exploration, v0.7 behavior
 *
 * - 'aggressive': Maximum recall, may include loose matches
 *   Best for: Discovery, finding potential connections
 */
export type StrictnessMode = 'conservative' | 'balanced' | 'aggressive';

/**
 * Scoring layers that can be individually disabled for ablation testing.
 *
 * Maps to the 11-layer scoring architecture in suggestRelatedLinks():
 * - 1a: length_filter (>25 chars)
 * - 1b: article_filter (article-like titles)
 * - 2: exact_match (verbatim token match)
 * - 3: stem_match (porter stemmer match)
 * - 4: cooccurrence (co-appearing entities)
 * - 5: type_boost (entity category priority)
 * - 6: context_boost (note context relevance)
 * - 7: recency (recently-mentioned entities)
 * - 8: cross_folder (cross-cutting connections)
 * - 9: hub_boost (well-connected entities)
 * - 10: feedback (historical accuracy adjustment)
 * - 11: semantic (embedding similarity)
 * - 12: edge_weight (high-quality incoming link boost)
 */
export type ScoringLayer =
  | 'length_filter' | 'article_filter'
  | 'exact_match' | 'stem_match'
  | 'cooccurrence'
  | 'type_boost' | 'context_boost'
  | 'recency' | 'cross_folder'
  | 'hub_boost' | 'feedback' | 'semantic'
  | 'edge_weight';

/**
 * Note context type inferred from path
 *
 * Used for context-aware entity boosting:
 * - 'daily': Daily notes, journals, logs - prioritize people mentions
 * - 'project': Project notes, systems - prioritize project/tech entities
 * - 'tech': Technical docs, code notes - prioritize technologies/acronyms
 * - 'general': Other notes - no context-specific boost
 */
export type NoteContext = 'daily' | 'project' | 'tech' | 'general';

/**
 * Configuration for suggestion scoring algorithm
 */
export interface SuggestionConfig {
  /** Minimum word length for tokenization (default: 4 for balanced, 5 for conservative) */
  minWordLength: number;
  /** Minimum score required for suggestion (default: 8 for balanced, 15 for conservative) */
  minSuggestionScore: number;
  /** Minimum ratio of matched words for multi-word entities (default: 0.4 for balanced, 0.6 for conservative) */
  minMatchRatio: number;
  /** Require multiple word matches for single-word entities (default: false for balanced, true for conservative) */
  requireMultipleMatches: boolean;
  /** Bonus points for stem matches (default: 5 for balanced, 3 for conservative) */
  stemMatchBonus: number;
  /** Bonus points for exact matches (default: 10 for all modes) */
  exactMatchBonus: number;
}

export interface SuggestOptions {
  maxSuggestions?: number;    // default: 3
  excludeLinked?: boolean;    // exclude entities already in content (default: true)
  strictness?: StrictnessMode; // default: 'conservative'
  notePath?: string;          // path to note for context-aware boosting
  detail?: boolean;           // return per-layer score breakdown (default: false)
  disabledLayers?: ScoringLayer[];  // layers to skip for ablation testing (default: [])
}

export interface ScoreBreakdown {
  contentMatch: number;       // Layers 2+3
  cooccurrenceBoost: number;  // Layer 4
  typeBoost: number;          // Layer 5
  contextBoost: number;       // Layer 6
  recencyBoost: number;       // Layer 7
  crossFolderBoost: number;   // Layer 8
  hubBoost: number;           // Layer 9
  feedbackAdjustment: number; // Layer 10
  semanticBoost?: number;     // Layer 11
  edgeWeightBoost?: number;   // Layer 12
}

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface ScoredSuggestion {
  entity: string;
  path: string;
  totalScore: number;
  breakdown: ScoreBreakdown;
  confidence: ConfidenceLevel;
  feedbackCount: number;
  accuracy?: number;
}

export interface SuggestResult {
  suggestions: string[];      // entity names suggested
  suffix: string;             // formatted suffix: "→ [[X]], [[Y]]" (empty when all scores < MIN_SUFFIX_SCORE)
  detailed?: ScoredSuggestion[];  // per-layer breakdown when detail=true
}

// ========================================
// AI Agent Memory Types
// ========================================

/**
 * Scoping metadata for multi-agent deployments.
 * Allows tracking which agent/session made a mutation.
 */
export interface ScopingMetadata {
  /** Agent identifier (e.g., "claude-opus", "planning-agent") */
  agent_id?: string;
  /** Session identifier for conversation scoping (e.g., "sess-abc123") */
  session_id?: string;
}

/**
 * Frontmatter fields injected by scoping system.
 * Uses underscore prefix to indicate system-managed fields.
 */
export interface ScopingFrontmatter {
  /** Agent that last modified this note */
  _agent_id?: string;
  /** Session that last modified this note */
  _session_id?: string;
  /** Agent/session that made the last modification */
  _last_modified_by?: string;
  /** ISO timestamp of last modification */
  _last_modified_at?: string;
  /** Count of modifications to this note */
  _modification_count?: number;
  /** Content source attribution ("ai" when modified by an AI agent) */
  _source?: string;
}

/**
 * Interaction log entry for episodic memory.
 * Represents a structured record of an agent-user or agent-system interaction.
 */
export interface InteractionLog {
  /** Unique interaction identifier */
  id: string;
  /** Agent that logged this interaction */
  agent_id: string;
  /** Optional session context */
  session_id?: string;
  /** Type of interaction (conversation, tool_use, decision, observation, etc.) */
  interaction_type: string;
  /** Brief summary of the interaction */
  summary: string;
  /** Entities involved or mentioned */
  entities_involved?: string[];
  /** Additional structured metadata */
  metadata?: Record<string, unknown>;
  /** ISO timestamp when interaction occurred */
  timestamp: string;
}

/**
 * Search filters for querying interactions.
 */
export interface InteractionSearchFilters {
  /** Filter by agent */
  agent_id?: string;
  /** Filter by session */
  session_id?: string;
  /** Filter by interaction type */
  interaction_type?: string;
  /** Start of time range (ISO string) */
  time_start?: string;
  /** End of time range (ISO string) */
  time_end?: string;
  /** Filter by entity involvement */
  entity?: string;
  /** Maximum results to return */
  limit?: number;
}

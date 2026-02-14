/**
 * Unified types for Flywheel Memory
 * Combines read (flywheel) and write (crank) type definitions
 */

// ========================================
// Vault Index Types (Read)
// ========================================

/** A wikilink extracted from a note */
export interface OutLink {
  target: string;      // Note title or path (without .md)
  alias?: string;      // Display text from [[target|alias]]
  line: number;        // 1-indexed line number
}

/** A parsed note from the vault */
export interface VaultNote {
  path: string;                           // Relative to vault root, with .md
  title: string;                          // Filename without .md
  aliases: string[];                      // From frontmatter aliases field
  frontmatter: Record<string, unknown>;   // All frontmatter data
  outlinks: OutLink[];                    // [[wikilinks]] this note contains
  tags: string[];                         // #tags from content + frontmatter
  modified: Date;                         // File modification time
  created?: Date;                         // File creation time (if available)
}

/** Backlink info - a note that links to another note */
export interface Backlink {
  source: string;      // Path of the note containing the link
  line: number;        // Line number where the link appears
  context?: string;    // Surrounding text for context
}

/** The complete vault index */
export interface VaultIndex {
  notes: Map<string, VaultNote>;           // path -> VaultNote
  backlinks: Map<string, Backlink[]>;      // normalized target -> backlinks
  entities: Map<string, string>;           // lowercase title/alias -> path
  tags: Map<string, Set<string>>;          // tag -> note paths
  builtAt: Date;                           // When the index was built (for staleness detection)
}

// ========================================
// Mutation Types (Write)
// ========================================

/** Content hash for change tracking */
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
}

// ========================================
// Wikilink Suggestion Types
// ========================================

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
}

export interface SuggestResult {
  suggestions: string[];      // entity names suggested
  suffix: string;             // formatted suffix: "→ [[X]], [[Y]]"
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

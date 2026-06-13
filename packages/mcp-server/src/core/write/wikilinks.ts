/**
 * Wikilink integration for Flywheel Memory — FACADE
 *
 * Explicit named re-exports preserving the historical import surface of the
 * pre-split wikilinks.ts (arch-review G5, part F2). House pattern:
 * core/write/writer.ts. New code inside core/write/wikilink* must import the
 * concrete modules directly, never this facade:
 *
 *   wikilinkState.ts         — DI/module state, ALS scope pairs, entity-index lifecycle
 *   wikilinkPipeline.ts      — validation/sanitize/prioritize + processWikilinks/maybeApplyWikilinks
 *   wikilinkScoringConfig.ts — scoring config tables + pure helpers
 *   wikilinkSuggest.ts       — suggestRelatedLinks scoring engine
 *   noteCreationChecks.ts    — alias collisions, alias suggestions, preflight similarity
 *   proactiveWriter.ts       — background high-confidence link writer
 *   wikilinkFeedbackStore.ts — all wikilink-family SQL (incl. suggestion_events)
 */

export {
  setWriteStateDb,
  getWriteStateDb,
  setWikilinkConfig,
  getWikilinkStrictness,
  getCooccurrenceIndex,
  setCooccurrenceIndex,
  initializeEntityIndex,
  isEntityIndexReady,
  getEntityIndex,
  checkAndRefreshIfStale,
  getEntityIndexStats,
} from './wikilinkState.js';

export {
  isValidWikilinkText,
  sanitizeWikilinks,
  processWikilinks,
  maybeApplyWikilinks,
} from './wikilinkPipeline.js';

export {
  isLikelyArticleTitle,
  getNoteContext,
} from './wikilinkScoringConfig.js';

export { suggestRelatedLinks } from './wikilinkSuggest.js';

export {
  detectAliasCollisions,
  suggestAliases,
  checkPreflightSimilarity,
} from './noteCreationChecks.js';
export type {
  AliasCollision,
  AliasSuggestion,
  PreflightResult,
} from './noteCreationChecks.js';

export { applyProactiveSuggestions } from './proactiveWriter.js';

// extractLinkedEntities moved to wikilinkText.ts (arch-review S1: breaks the
// wikilinks ⇄ wikilinkFeedback import cycle); re-exported for existing importers.
export { extractLinkedEntities } from './wikilinkText.js';

/**
 * Flywheel Bench - Shared benchmark infrastructure
 *
 * Provides:
 * - Vault generation for testing (1k to 100k notes)
 * - Benchmark harness with JSON output
 * - Regression detection
 * - Stress testing for long-term stability
 * - Operation logging
 */

// Types
export * from './types.js';

// Generator
export {
  generateVault,
  generateQuickVault,
  loadVaultConfig,
  VAULT_PRESETS
} from './generator/vault.js';
export { SeededRandom, generateNoteTitle, generateNoteContent, titleToFilename } from './generator/notes.js';
export { generateEntities, generateEntityNotes } from './generator/entities.js';
export { generateFrontmatter, frontmatterToYaml, wrapWithFrontmatter } from './generator/frontmatter.js';
export { generateFolderStructure, pickFolderForNote } from './generator/structure.js';

// Harness
export {
  BenchmarkRunner,
  benchmark,
  runBenchmarks,
  DEFAULT_CONFIG as DEFAULT_BENCHMARK_CONFIG
} from './harness/runner.js';
export {
  writeJsonReport,
  writeMarkdownReport,
  printResults,
  createComparisonReport
} from './harness/reporter.js';
export {
  detectRegressions,
  compareResults,
  hasCriticalRegressions,
  saveBaseline,
  loadBaseline,
  formatRegressionsForCI,
  exitIfRegressions,
  DEFAULT_THRESHOLDS
} from './harness/regression.js';

// Iteration testing
export {
  runStressTest,
  createDefaultMutationFunctions,
  validateStressTestResults,
  DEFAULT_STRESS_CONFIG
} from './iteration/stressTest.js';
export type { MutationFunctions } from './iteration/stressTest.js';
export { checkIntegrity, generateIntegrityReport } from './iteration/integrityChecker.js';
export {
  checkGitHealth,
  runGitMaintenance,
  getGitStats,
  measureGitPerformance
} from './iteration/gitHealthChecker.js';
export {
  PerformanceTracker,
  timeOperation,
  timeAsyncOperation
} from './iteration/performanceTracker.js';
// Simplified iteration stress test
export {
  runIterationStressTest,
  type IterationStressConfig,
  type IterationStressResult
} from './iteration/index.js';

// Logging
export {
  OperationLogger,
  createLoggerFromVault,
  loadFlywheelConfig,
  formatMetricsReport
} from './logging/logger.js';
export { OperationLogWriter, readOperationLog, getLogStats } from './logging/operationLog.js';
export { DEFAULT_FLYWHEEL_CONFIG } from './logging/types.js';
export type {
  LoggingConfig,
  OperationLogEntry,
  AggregatedMetrics,
  ToolMetrics,
  FlywheelConfig
} from './logging/types.js';

// Reliability testing
export {
  runAllReliabilityTests,
  runRollbackTests,
  runLockContentionTests,
  runIdempotencyTests,
  runIntegrityTests,
  printReliabilitySummary,
  createTestDir,
  cleanupTestDir,
  type ReliabilitySummary
} from './reliability/index.js';
export type {
  ReliabilityTestResult,
  ReliabilityTestConfig,
  IntegrityCheckResult,
  StagedFileInfo,
  GitFailureType
} from './reliability/types.js';

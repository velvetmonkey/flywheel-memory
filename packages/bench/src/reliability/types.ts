/**
 * Types for reliability testing
 */

/**
 * Result of a reliability test
 */
export interface ReliabilityTestResult {
  /** Test name */
  name: string;
  /** Whether the test passed */
  passed: boolean;
  /** Detailed message */
  message: string;
  /** Duration in ms */
  duration_ms: number;
  /** Additional metrics */
  metrics?: Record<string, number | string | boolean>;
}

/**
 * Configuration for reliability tests
 */
export interface ReliabilityTestConfig {
  /** Path to the test vault */
  vaultPath: string;
  /** Whether the vault is a git repo */
  isGitRepo?: boolean;
  /** Number of iterations for stress tests */
  iterations?: number;
  /** Timeout in ms */
  timeout?: number;
}

/**
 * Mock git failure type
 */
export type GitFailureType =
  | 'lock_contention'
  | 'permission_denied'
  | 'network_error'
  | 'disk_full';

/**
 * Staged file info for rollback testing
 */
export interface StagedFileInfo {
  /** Vault-relative path */
  path: string;
  /** Original content (null if didn't exist) */
  originalContent: string | null;
  /** New content that was written */
  newContent: string;
}

/**
 * Vault integrity check result
 */
export interface IntegrityCheckResult {
  /** Whether vault is intact */
  intact: boolean;
  /** List of corrupted files */
  corruptedFiles: string[];
  /** List of orphaned files */
  orphanedFiles: string[];
  /** List of missing files */
  missingFiles: string[];
  /** Any error messages */
  errors: string[];
}

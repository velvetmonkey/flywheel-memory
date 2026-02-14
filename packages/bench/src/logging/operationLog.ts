/**
 * JSONL operation log writer
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { OperationLogEntry, LoggingConfig } from './types.js';

/**
 * JSONL log writer with rotation support
 */
export class OperationLogWriter {
  private config: LoggingConfig;
  private writeQueue: OperationLogEntry[] = [];
  private isWriting = false;

  constructor(config: LoggingConfig) {
    this.config = config;
  }

  /**
   * Append a log entry
   */
  async write(entry: OperationLogEntry): Promise<void> {
    if (!this.config.enabled) return;

    // Apply privacy filtering
    const sanitized = this.sanitizeEntry(entry);

    this.writeQueue.push(sanitized);
    await this.flush();
  }

  /**
   * Flush queued entries to disk
   */
  private async flush(): Promise<void> {
    if (this.isWriting || this.writeQueue.length === 0) return;

    this.isWriting = true;

    try {
      // Ensure directory exists
      const dir = path.dirname(this.config.logPath);
      await fs.mkdir(dir, { recursive: true });

      // Check if rotation needed
      await this.checkRotation();

      // Write all queued entries
      const entries = this.writeQueue.splice(0);
      const lines = entries.map(e => JSON.stringify(e)).join('\n') + '\n';

      await fs.appendFile(this.config.logPath, lines, 'utf-8');
    } catch (error) {
      console.error('Failed to write operation log:', error);
    } finally {
      this.isWriting = false;

      // Check if more entries were queued during write
      if (this.writeQueue.length > 0) {
        await this.flush();
      }
    }
  }

  /**
   * Check if log rotation is needed
   */
  private async checkRotation(): Promise<void> {
    if (!this.config.rotation) return;

    try {
      const stats = await fs.stat(this.config.logPath);
      const sizeMb = stats.size / (1024 * 1024);

      if (sizeMb >= this.config.rotation.maxSize_mb) {
        await this.rotate();
      }
    } catch {
      // File doesn't exist yet, no rotation needed
    }
  }

  /**
   * Rotate log files
   */
  private async rotate(): Promise<void> {
    if (!this.config.rotation) return;

    const { maxFiles } = this.config.rotation;
    const basePath = this.config.logPath;

    // Delete oldest file
    try {
      await fs.unlink(`${basePath}.${maxFiles}`);
    } catch {
      // File doesn't exist
    }

    // Shift existing files
    for (let i = maxFiles - 1; i >= 1; i--) {
      try {
        await fs.rename(`${basePath}.${i}`, `${basePath}.${i + 1}`);
      } catch {
        // File doesn't exist
      }
    }

    // Move current log to .1
    try {
      await fs.rename(basePath, `${basePath}.1`);
    } catch {
      // File doesn't exist
    }
  }

  /**
   * Apply privacy settings to entry
   */
  private sanitizeEntry(entry: OperationLogEntry): OperationLogEntry {
    const sanitized = { ...entry };

    if (this.config.privacy) {
      // Anonymize vault path if content logging is disabled
      if (!this.config.privacy.logContent) {
        sanitized.vault = this.anonymizePath(sanitized.vault);
      }

      // Remove note titles if disabled
      if (!this.config.privacy.logNoteTitles && sanitized.metadata) {
        delete sanitized.metadata.noteTitle;
        delete sanitized.metadata.notePath;
      }
    }

    return sanitized;
  }

  /**
   * Anonymize a path (keep structure, hash identifiers)
   */
  private anonymizePath(p: string): string {
    const parts = p.split(path.sep);
    return parts.map(part => {
      // Keep common directory names
      if (['Users', 'home', 'Documents', '.obsidian', '.flywheel'].includes(part)) {
        return part;
      }
      // Hash other parts
      return `[${this.simpleHash(part)}]`;
    }).join(path.sep);
  }

  /**
   * Simple string hash for anonymization
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36).slice(0, 8);
  }
}

/**
 * Read and parse a JSONL log file
 */
export async function readOperationLog(
  logPath: string,
  options: { since?: Date; until?: Date; tool?: string } = {}
): Promise<OperationLogEntry[]> {
  try {
    const content = await fs.readFile(logPath, 'utf-8');
    const lines = content.trim().split('\n').filter(l => l.trim());

    const entries: OperationLogEntry[] = [];

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as OperationLogEntry;

        // Apply filters
        if (options.since) {
          const entryDate = new Date(entry.timestamp);
          if (entryDate < options.since) continue;
        }

        if (options.until) {
          const entryDate = new Date(entry.timestamp);
          if (entryDate > options.until) continue;
        }

        if (options.tool && entry.tool !== options.tool) {
          continue;
        }

        entries.push(entry);
      } catch {
        // Skip malformed lines
      }
    }

    return entries;
  } catch {
    return [];
  }
}

/**
 * Get log file statistics
 */
export async function getLogStats(logPath: string): Promise<{
  entries: number;
  size_mb: number;
  oldest?: string;
  newest?: string;
}> {
  try {
    const stats = await fs.stat(logPath);
    const entries = await readOperationLog(logPath);

    return {
      entries: entries.length,
      size_mb: stats.size / (1024 * 1024),
      oldest: entries[0]?.timestamp,
      newest: entries[entries.length - 1]?.timestamp
    };
  } catch {
    return { entries: 0, size_mb: 0 };
  }
}

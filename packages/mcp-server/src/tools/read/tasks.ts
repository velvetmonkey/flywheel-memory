/**
 * Task primitives - extract and aggregate tasks from vault
 *
 * Answer: "What needs to be done?"
 */

import * as fs from 'fs';
import * as path from 'path';
import type { VaultIndex } from '../../core/read/types.js';

/** A task extracted from a note */
export interface Task {
  path: string;          // Note path
  line: number;          // 1-indexed line number
  text: string;          // Task text (without checkbox)
  status: 'open' | 'completed' | 'cancelled';
  raw: string;           // Original line
  context?: string;      // Parent heading if available
  tags: string[];        // Tags in the task line
  due_date?: string;     // If a date pattern is found
}

/** Regex to match task lines */
const TASK_REGEX = /^(\s*)- \[([ xX\-])\]\s+(.+)$/;

/** Regex to find tags in task text */
const TAG_REGEX = /#([a-zA-Z][a-zA-Z0-9_/-]*)/g;

/** Regex to find dates (various formats) */
const DATE_REGEX = /\b(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/;

/** Regex to match headings for context */
const HEADING_REGEX = /^(#{1,6})\s+(.+)$/;

/**
 * Parse task status from checkbox character
 */
function parseStatus(char: string): 'open' | 'completed' | 'cancelled' {
  if (char === ' ') return 'open';
  if (char === '-') return 'cancelled';
  return 'completed';  // x or X
}

/**
 * Extract tags from task text
 */
function extractTags(text: string): string[] {
  const tags: string[] = [];
  let match;
  TAG_REGEX.lastIndex = 0;
  while ((match = TAG_REGEX.exec(text)) !== null) {
    tags.push(match[1]);
  }
  return tags;
}

/**
 * Extract due date from task text
 */
function extractDueDate(text: string): string | undefined {
  const match = text.match(DATE_REGEX);
  return match ? match[1] : undefined;
}

/**
 * Extract all tasks from a single note
 */
async function extractTasksFromNote(
  notePath: string,
  absolutePath: string
): Promise<Task[]> {
  let content: string;
  try {
    content = await fs.promises.readFile(absolutePath, 'utf-8');
  } catch {
    return [];
  }

  const lines = content.split('\n');
  const tasks: Task[] = [];
  let currentHeading: string | undefined;
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track code blocks
    if (line.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) continue;

    // Track headings for context
    const headingMatch = line.match(HEADING_REGEX);
    if (headingMatch) {
      currentHeading = headingMatch[2].trim();
      continue;
    }

    // Check for task
    const taskMatch = line.match(TASK_REGEX);
    if (taskMatch) {
      const statusChar = taskMatch[2];
      const text = taskMatch[3].trim();

      tasks.push({
        path: notePath,
        line: i + 1,
        text,
        status: parseStatus(statusChar),
        raw: line,
        context: currentHeading,
        tags: extractTags(text),
        due_date: extractDueDate(text),
      });
    }
  }

  return tasks;
}

/**
 * Get all tasks from the vault
 */
export async function getAllTasks(
  index: VaultIndex,
  vaultPath: string,
  options: {
    status?: 'open' | 'completed' | 'cancelled' | 'all';
    folder?: string;
    tag?: string;
    excludeTags?: string[];
    limit?: number;
  } = {}
): Promise<{
  total: number;
  open_count: number;
  completed_count: number;
  cancelled_count: number;
  tasks: Task[];
}> {
  const { status = 'all', folder, tag, excludeTags = [], limit } = options;

  const allTasks: Task[] = [];

  for (const note of index.notes.values()) {
    // Filter by folder
    if (folder && !note.path.startsWith(folder)) continue;

    const absolutePath = path.join(vaultPath, note.path);
    const tasks = await extractTasksFromNote(note.path, absolutePath);
    allTasks.push(...tasks);
  }

  // Filter by status
  let filteredTasks = allTasks;
  if (status !== 'all') {
    filteredTasks = allTasks.filter(t => t.status === status);
  }

  // Filter by tag
  if (tag) {
    filteredTasks = filteredTasks.filter(t => t.tags.includes(tag));
  }

  // Exclude tasks with specific tags
  if (excludeTags.length > 0) {
    filteredTasks = filteredTasks.filter(
      t => !excludeTags.some(excludeTag => t.tags.includes(excludeTag))
    );
  }

  // Count by status
  const openCount = allTasks.filter(t => t.status === 'open').length;
  const completedCount = allTasks.filter(t => t.status === 'completed').length;
  const cancelledCount = allTasks.filter(t => t.status === 'cancelled').length;

  // Apply limit
  const returnTasks = limit ? filteredTasks.slice(0, limit) : filteredTasks;

  return {
    total: allTasks.length,
    open_count: openCount,
    completed_count: completedCount,
    cancelled_count: cancelledCount,
    tasks: returnTasks,
  };
}

/**
 * Get tasks from a specific note
 */
export async function getTasksFromNote(
  index: VaultIndex,
  notePath: string,
  vaultPath: string,
  excludeTags: string[] = []
): Promise<Task[] | null> {
  const note = index.notes.get(notePath);
  if (!note) return null;

  const absolutePath = path.join(vaultPath, notePath);
  let tasks = await extractTasksFromNote(notePath, absolutePath);

  // Filter out tasks with excluded tags
  if (excludeTags.length > 0) {
    tasks = tasks.filter(
      t => !excludeTags.some(excludeTag => t.tags.includes(excludeTag))
    );
  }

  return tasks;
}

/**
 * Get tasks with due dates
 */
export async function getTasksWithDueDates(
  index: VaultIndex,
  vaultPath: string,
  options: {
    status?: 'open' | 'completed' | 'cancelled' | 'all';
    folder?: string;
    excludeTags?: string[];
  } = {}
): Promise<Task[]> {
  const { status = 'open', folder, excludeTags } = options;

  const result = await getAllTasks(index, vaultPath, { status, folder, excludeTags });

  // Filter to only tasks with due dates and sort by date
  return result.tasks
    .filter(t => t.due_date)
    .sort((a, b) => {
      // Sort by due date
      const dateA = a.due_date || '';
      const dateB = b.due_date || '';
      return dateA.localeCompare(dateB);
    });
}

/**
 * Get task summary by context (heading)
 */
export async function getTasksByContext(
  index: VaultIndex,
  vaultPath: string,
  folder?: string,
  excludeTags?: string[]
): Promise<Record<string, { open: number; completed: number; tasks: Task[] }>> {
  const result = await getAllTasks(index, vaultPath, { folder, excludeTags });

  const byContext: Record<string, { open: number; completed: number; tasks: Task[] }> = {};

  for (const task of result.tasks) {
    const context = task.context || '(no heading)';

    if (!byContext[context]) {
      byContext[context] = { open: 0, completed: 0, tasks: [] };
    }

    byContext[context].tasks.push(task);

    if (task.status === 'open') {
      byContext[context].open++;
    } else if (task.status === 'completed') {
      byContext[context].completed++;
    }
  }

  return byContext;
}

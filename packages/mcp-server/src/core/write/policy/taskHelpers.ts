/**
 * Task helper utilities for policy executor
 * Extracted to avoid circular dependencies with tools/tasks.ts
 */

import type { SectionBoundary } from '../writer.js';

// Task regex patterns
const TASK_REGEX = /^(\s*)-\s*\[([ xX])\]\s*(.*)$/;

export interface TaskInfo {
  line: number;
  text: string;
  completed: boolean;
  indent: string;
  rawLine: string;
}

/**
 * Find all tasks in content, optionally within a section
 */
export function findTasks(content: string, section?: SectionBoundary): TaskInfo[] {
  const lines = content.split('\n');
  const tasks: TaskInfo[] = [];

  const startLine = section?.contentStartLine ?? 0;
  const endLine = section?.endLine ?? lines.length - 1;

  for (let i = startLine; i <= endLine; i++) {
    const line = lines[i];
    const match = line.match(TASK_REGEX);

    if (match) {
      tasks.push({
        line: i,
        text: match[3].trim(),
        completed: match[2].toLowerCase() === 'x',
        indent: match[1],
        rawLine: line,
      });
    }
  }

  return tasks;
}

/**
 * Toggle a task's completion state
 */
export function toggleTask(content: string, lineNumber: number): { content: string; newState: boolean } | null {
  const lines = content.split('\n');

  if (lineNumber < 0 || lineNumber >= lines.length) {
    return null;
  }

  const line = lines[lineNumber];
  const match = line.match(TASK_REGEX);

  if (!match) {
    return null;
  }

  const wasCompleted = match[2].toLowerCase() === 'x';
  const newState = !wasCompleted;

  // Toggle the checkbox
  if (wasCompleted) {
    lines[lineNumber] = line.replace(/\[[ xX]\]/, '[ ]');
  } else {
    lines[lineNumber] = line.replace(/\[[ xX]\]/, '[x]');
  }

  return {
    content: lines.join('\n'),
    newState,
  };
}

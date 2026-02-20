/**
 * Lightweight template engine for policy variable interpolation
 *
 * Supports:
 * - {{variable}} - Variable substitution
 * - {{path.nested}} - Dot notation for nested values
 * - {{value | filter}} - Filters (upper, lower, trim, default)
 * - {{now}}, {{today}}, {{time}}, {{date}} - Built-in values
 */

import type { PolicyContext } from './types.js';

/**
 * Pattern to match template expressions: {{...}}
 */
const TEMPLATE_PATTERN = /\{\{([^}]+)\}\}/g;

/**
 * Pattern to match filter syntax: value | filter or value | filter(arg)
 */
const FILTER_PATTERN = /^(.+?)\s*\|\s*(\w+)(?:\(([^)]*)\))?$/;

/**
 * Available filter functions
 */
const FILTERS: Record<string, (value: unknown, arg?: string) => unknown> = {
  /** Convert to uppercase */
  upper: (value) => String(value).toUpperCase(),

  /** Convert to lowercase */
  lower: (value) => String(value).toLowerCase(),

  /** Trim whitespace */
  trim: (value) => String(value).trim(),

  /** Provide default value if empty/undefined */
  default: (value, arg) => {
    if (value === undefined || value === null || value === '') {
      return arg ?? '';
    }
    return value;
  },

  /** Format as date (YYYY-MM-DD) */
  date: (value) => {
    if (value instanceof Date) {
      return formatDate(value);
    }
    const date = new Date(String(value));
    return isNaN(date.getTime()) ? String(value) : formatDate(date);
  },

  /** Format as time (HH:MM) */
  time: (value) => {
    if (value instanceof Date) {
      return formatTime(value);
    }
    const date = new Date(String(value));
    return isNaN(date.getTime()) ? String(value) : formatTime(date);
  },

  /** Format as ISO timestamp */
  iso: (value) => {
    if (value instanceof Date) {
      return value.toISOString();
    }
    const date = new Date(String(value));
    return isNaN(date.getTime()) ? String(value) : date.toISOString();
  },

  /** Join array with separator (default: ", ") */
  join: (value, arg) => {
    if (Array.isArray(value)) {
      return value.join(arg ?? ', ');
    }
    return String(value);
  },

  /** Get first element of array or first character of string */
  first: (value) => {
    if (Array.isArray(value)) {
      return value[0];
    }
    return String(value).charAt(0);
  },

  /** Get last element of array or last character of string */
  last: (value) => {
    if (Array.isArray(value)) {
      return value[value.length - 1];
    }
    const str = String(value);
    return str.charAt(str.length - 1);
  },

  /** Slugify: lowercase, replace spaces with dashes */
  slug: (value) => {
    return String(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  },
};

/**
 * Format date as YYYY-MM-DD
 */
function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Format time as HH:MM
 */
function formatTime(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Create a context with built-in values populated
 */
export function createContext(variables: Record<string, unknown> = {}): PolicyContext {
  const now = new Date();
  return {
    variables,
    conditions: {},
    builtins: {
      now: now.toISOString(),
      today: formatDate(now),
      time: formatTime(now),
      date: formatDate(now),
    },
    steps: {},
  };
}

/**
 * Resolve a dot-notation path against an object
 *
 * @example
 * resolvePath({ user: { name: 'Alice' } }, 'user.name') // 'Alice'
 * resolvePath({ items: [1, 2, 3] }, 'items.0') // 1
 */
export function resolvePath(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === undefined || current === null) {
      return undefined;
    }

    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  return current;
}

/**
 * Apply a filter to a value
 */
export function applyFilter(value: unknown, filterName: string, arg?: string): unknown {
  const filter = FILTERS[filterName];
  if (!filter) {
    // Unknown filter, return value unchanged
    console.error(`[Policy] Unknown filter: ${filterName}`);
    return value;
  }
  return filter(value, arg);
}

/**
 * Resolve a single template expression (without {{ }})
 */
export function resolveExpression(expr: string, context: PolicyContext): unknown {
  const trimmed = expr.trim();

  // Check for filter syntax: value | filter
  const filterMatch = trimmed.match(FILTER_PATTERN);
  if (filterMatch) {
    const [, valuePath, filterName, filterArg] = filterMatch;
    const value = resolveExpression(valuePath.trim(), context);
    return applyFilter(value, filterName, filterArg);
  }

  // Built-in values (now, today, time, date)
  if (trimmed in context.builtins) {
    return context.builtins[trimmed as keyof typeof context.builtins];
  }

  // Check namespaced paths
  if (trimmed.startsWith('variables.')) {
    return resolvePath(context.variables, trimmed.slice('variables.'.length));
  }

  if (trimmed.startsWith('conditions.')) {
    return resolvePath(context.conditions, trimmed.slice('conditions.'.length));
  }

  if (trimmed.startsWith('builtins.')) {
    return resolvePath(context.builtins, trimmed.slice('builtins.'.length));
  }

  if (trimmed.startsWith('steps.')) {
    return resolvePath(context.steps, trimmed.slice('steps.'.length));
  }

  // Default: look up in variables
  return resolvePath(context.variables, trimmed);
}

/**
 * Interpolate all {{...}} expressions in a string
 */
export function interpolate(template: string, context: PolicyContext): string {
  return template.replace(TEMPLATE_PATTERN, (match, expr) => {
    const value = resolveExpression(expr, context);
    if (value === undefined) {
      // Return original placeholder if not found (helps with debugging)
      console.error(`[Policy] Unresolved template expression: ${match}`);
      return match;
    }
    return String(value);
  });
}

/**
 * Recursively interpolate all string values in an object
 */
export function interpolateObject<T>(obj: T, context: PolicyContext): T {
  if (typeof obj === 'string') {
    return interpolate(obj, context) as T;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => interpolateObject(item, context)) as T;
  }

  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = interpolateObject(value, context);
    }
    return result as T;
  }

  return obj;
}

/**
 * Extract all template expressions from a string
 * Useful for validation and dependency analysis
 */
export function extractExpressions(template: string): string[] {
  const matches: string[] = [];
  let match: RegExpExecArray | null;

  // Reset regex state
  TEMPLATE_PATTERN.lastIndex = 0;

  while ((match = TEMPLATE_PATTERN.exec(template)) !== null) {
    matches.push(match[1].trim());
  }

  return matches;
}

/**
 * Extract variable names referenced in a template
 * Returns only variable references (not conditions, steps, or builtins)
 */
export function extractVariableRefs(template: string): string[] {
  const expressions = extractExpressions(template);
  const variables = new Set<string>();
  const builtins = ['now', 'today', 'time', 'date'];

  for (const expr of expressions) {
    // Remove filter if present
    const filterMatch = expr.match(FILTER_PATTERN);
    const path = filterMatch ? filterMatch[1].trim() : expr;

    // Skip builtins
    if (builtins.includes(path)) continue;

    // Skip conditions and steps
    if (path.startsWith('conditions.')) continue;
    if (path.startsWith('steps.')) continue;

    // Remove variables. prefix if present
    const varName = path.startsWith('variables.')
      ? path.slice('variables.'.length).split('.')[0]
      : path.split('.')[0];

    variables.add(varName);
  }

  return Array.from(variables);
}

/**
 * Check if a string contains template expressions
 */
export function hasTemplateExpressions(str: string): boolean {
  TEMPLATE_PATTERN.lastIndex = 0;
  return TEMPLATE_PATTERN.test(str);
}

/**
 * Validate that all template expressions can be resolved
 */
export function validateExpressions(
  template: string,
  context: PolicyContext
): { valid: boolean; unresolved: string[] } {
  const expressions = extractExpressions(template);
  const unresolved: string[] = [];

  for (const expr of expressions) {
    const value = resolveExpression(expr, context);
    if (value === undefined) {
      unresolved.push(expr);
    }
  }

  return {
    valid: unresolved.length === 0,
    unresolved,
  };
}

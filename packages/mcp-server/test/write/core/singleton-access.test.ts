/**
 * Singleton Access Guard
 *
 * Enforces that module-level mutable state variables in the MCP server core
 * are only directly accessed inside their designated getter/setter functions.
 *
 * Direct reads outside these functions risk cross-vault data corruption
 * in multi-vault mode, because the module-level variable may hold a
 * reference to a different vault's state than the one the current
 * request should be using.
 *
 * Each rule specifies:
 *   - The file containing the singleton
 *   - The variable name (string or regex)
 *   - The only functions allowed to read/write it directly
 *
 * Everything else must go through the getter (which checks ALS scope first).
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Rule definitions
// ---------------------------------------------------------------------------

interface SingletonRule {
  /** Relative path from packages/mcp-server/src/core/ */
  file: string;
  /** Variable to guard — string for exact match, RegExp for pattern */
  variable: string | RegExp;
  /** Functions that ARE allowed to touch the variable directly */
  allowedFunctions: string[];
}

const RULES: SingletonRule[] = [
  {
    file: 'write/wikilinks.ts',
    variable: 'moduleStateDb',
    allowedFunctions: ['setWriteStateDb', 'getWriteStateDb'],
  },
  {
    file: 'write/git.ts',
    variable: 'moduleStateDb',
    allowedFunctions: ['setGitStateDb', 'getStateDb'],
  },
  {
    file: 'write/hints.ts',
    variable: 'moduleStateDb',
    allowedFunctions: ['setHintsStateDb', 'getStateDb'],
  },
  {
    file: 'read/fts5.ts',
    variable: /\bdb\b/,
    allowedFunctions: ['setFTS5Database', 'getDb', 'closeFTS5'],
  },
  {
    file: 'read/taskCache.ts',
    variable: /\bdb\b/,
    allowedFunctions: ['setTaskCacheDatabase', 'getDb'],
  },
  {
    file: 'shared/recency.ts',
    variable: 'moduleStateDb',
    allowedFunctions: ['setRecencyStateDb', 'getStateDb'],
  },
  {
    file: 'read/embeddings.ts',
    variable: /\bdb\b/,
    allowedFunctions: ['setEmbeddingsDatabase', 'getDb'],
  },
  {
    file: 'read/embeddings.ts',
    variable: 'entityEmbeddingsMap',
    allowedFunctions: ['getEmbMap'],
  },
  {
    file: 'read/embeddings.ts',
    variable: 'inferredCategoriesMap',
    allowedFunctions: ['getInferredMap', 'setInferredMap'],
  },
  {
    file: 'write/wikilinks.ts',
    variable: 'entityIndex',
    allowedFunctions: ['getScopedEntityIndex', 'setScopedEntityIndex'],
  },
  {
    file: 'write/wikilinks.ts',
    variable: 'indexReady',
    allowedFunctions: ['isScopedEntityIndexReady', 'setScopedEntityIndexReady'],
  },
  {
    file: 'write/wikilinks.ts',
    variable: 'indexError',
    allowedFunctions: ['getScopedEntityIndexError', 'setScopedEntityIndexError'],
  },
  {
    file: 'write/wikilinks.ts',
    variable: 'lastLoadedAt',
    allowedFunctions: ['getScopedEntityIndexLastLoadedAt', 'setScopedEntityIndexLastLoadedAt'],
  },
  {
    file: 'write/wikilinks.ts',
    variable: 'recencyIndex',
    allowedFunctions: ['getScopedRecencyIndex', 'setScopedRecencyIndex'],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CORE_ROOT = path.resolve(
  __dirname,
  '../../../src/core',
);

/**
 * Determine which named function (if any) contains a given line.
 *
 * Strategy: walk the file top-to-bottom tracking function boundaries
 * via brace counting.  We detect function declarations of the forms:
 *
 *   function foo(...)  {
 *   export function foo(...) {
 *   async function foo(...) {
 *   export async function foo(...) {
 *   const foo = (...) => {
 *   const foo = function(...) {
 *
 * Returns a Map<lineNumber, functionName | null>.
 */
function buildLineToFunctionMap(source: string): Map<number, string | null> {
  const lines = source.split('\n');
  const map = new Map<number, string | null>();

  // Stack of { name, braceDepth (depth at the opening brace) }
  const stack: Array<{ name: string; openDepth: number }> = [];
  let braceDepth = 0;

  // Regex to detect function declarations.
  // Captures the function name from various declaration styles.
  const funcDeclRe =
    /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\(/;
  // Only match direct arrow / function-expression assignments:
  //   const foo = () => {             const foo = async (x) => {
  //   const foo = function() {        const foo = async function() {
  // Do NOT match method-call-with-callback patterns like:
  //   const swapAll = db.transaction(() => {
  const arrowOrFuncExprRe =
    /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:(?:\([^)]*\)\s*=>)|(?:function\s*\())/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1; // 1-based

    // Before counting braces on this line, check if this line starts a
    // new function declaration.  We detect the opening brace on this or
    // a subsequent line.
    let funcName: string | null = null;
    const funcMatch = funcDeclRe.exec(line);
    if (funcMatch) {
      funcName = funcMatch[1];
    } else {
      const arrowMatch = arrowOrFuncExprRe.exec(line);
      if (arrowMatch) {
        funcName = arrowMatch[1];
      }
    }

    // Count braces on this line (ignoring those inside strings/comments
    // is hard in general, but for our codebase the simple count works
    // because the guarded variables don't appear inside string literals).
    let openCount = 0;
    let closeCount = 0;
    // Simple brace counter — skip characters inside string literals and
    // line comments to avoid false positives from template literals /
    // object literals inside strings.
    let inSingle = false;
    let inDouble = false;
    let inTemplate = false;
    let inLineComment = false;
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      const prev = c > 0 ? line[c - 1] : '';

      if (inLineComment) break; // rest of line is comment

      if (ch === '/' && line[c + 1] === '/' && !inSingle && !inDouble && !inTemplate) {
        inLineComment = true;
        continue;
      }

      if (ch === "'" && prev !== '\\' && !inDouble && !inTemplate) {
        inSingle = !inSingle;
        continue;
      }
      if (ch === '"' && prev !== '\\' && !inSingle && !inTemplate) {
        inDouble = !inDouble;
        continue;
      }
      if (ch === '`' && prev !== '\\' && !inSingle && !inDouble) {
        inTemplate = !inTemplate;
        continue;
      }

      if (inSingle || inDouble || inTemplate) continue;

      if (ch === '{') openCount++;
      if (ch === '}') closeCount++;
    }

    // If we found a function name on this line and there is an opening
    // brace, push onto the stack.  The openDepth is the depth BEFORE
    // this line's braces are applied — the function body ends when we
    // return to that depth.
    if (funcName !== null && openCount > 0) {
      stack.push({ name: funcName, openDepth: braceDepth });
    }

    braceDepth += openCount - closeCount;

    // The current function scope is the top of the stack (if any).
    map.set(lineNum, stack.length > 0 ? stack[stack.length - 1].name : null);

    // Pop any scopes that have closed.
    while (stack.length > 0 && braceDepth <= stack[stack.length - 1].openDepth) {
      stack.pop();
    }
  }

  return map;
}

/**
 * For rules where the variable is a short token like `db`, we need to
 * distinguish the module-level `let db` from local shadows (`const db = getDb()`).
 *
 * Strategy: within each function body, if we see `const db =` or the
 * function parameter list contains `db`, then subsequent uses of `db`
 * on later lines in that same function are local — not module reads.
 *
 * We also skip:
 *  - The declaration line itself (`let db: ...`)
 *  - Lines that are only comments
 *  - Property access patterns like `.db` or `stateDb`
 *  - Type annotations (`Database.Database`)
 */
function isModuleLevelRead(
  line: string,
  variablePattern: string | RegExp,
  isDeclarationLine: boolean,
): boolean {
  const trimmed = line.trim();

  // Skip pure comments
  if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
    return false;
  }

  // Skip the declaration line
  if (isDeclarationLine) return false;

  if (typeof variablePattern === 'string') {
    // For named variables like `moduleStateDb`, a simple word-boundary check suffices.
    const re = new RegExp(`\\b${variablePattern}\\b`);
    return re.test(line);
  }

  // For regex patterns like /\bdb\b/, we need extra filtering to avoid
  // false positives from local shadows and property access.
  const matches = [...line.matchAll(new RegExp(variablePattern, 'g'))];
  for (const m of matches) {
    const idx = m.index!;
    // Skip property access: `.db` (e.g., stateDb.db)
    if (idx > 0 && line[idx - 1] === '.') continue;
    // Skip compound identifiers containing 'db' as substring (e.g., stateDb, scopeDb)
    // Check character before match start
    if (idx > 0 && /\w/.test(line[idx - 1])) continue;
    // Check character after match end
    const endIdx = idx + m[0].length;
    if (endIdx < line.length && /\w/.test(line[endIdx])) continue;
    // This looks like a bare `db` token — it's a potential module-level read.
    return true;
  }
  return false;
}

interface Violation {
  file: string;
  line: number;
  text: string;
  variable: string;
  enclosingFunction: string | null;
}

function checkRule(rule: SingletonRule): Violation[] {
  const filePath = path.join(CORE_ROOT, rule.file);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Rule references missing file: ${filePath}`);
  }

  const source = fs.readFileSync(filePath, 'utf-8');
  const lines = source.split('\n');
  const lineToFunc = buildLineToFunctionMap(source);
  const violations: Violation[] = [];

  // Find the declaration line (to skip it)
  const varName = typeof rule.variable === 'string'
    ? rule.variable
    : 'db'; // for our regex rules, the actual variable is always `db`
  const declLineNum = lines.findIndex(
    l => {
      const trimmed = l.trim();
      return (
        trimmed.startsWith(`let ${varName}`) ||
        trimmed.startsWith(`let ${varName}:`) ||
        trimmed.startsWith(`const ${varName}`) ||
        trimmed.startsWith(`const ${varName}:`)
      );
    },
  ) + 1; // convert to 1-based, 0 means not found

  // Track local shadows per function.  When we enter a new function context
  // and see `const db = ...` or function param `db`, all subsequent `db`
  // references in that function are local.
  let currentFunc: string | null = null;
  let localShadowActive = false;
  const allowedSet = new Set(rule.allowedFunctions);

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const line = lines[i];
    const funcScope = lineToFunc.get(lineNum) ?? null;

    // Reset shadow tracking when we move to a different function scope
    if (funcScope !== currentFunc) {
      currentFunc = funcScope;
      localShadowActive = false;
    }

    // Detect local shadow introduction: `const db = getDb()` etc.
    if (typeof rule.variable !== 'string') {
      const shadowRe = /\b(?:const|let|var)\s+db\s*=/;
      if (shadowRe.test(line)) {
        localShadowActive = true;
        continue; // this line itself is fine
      }
    }

    // Skip lines inside allowed functions
    if (funcScope !== null && allowedSet.has(funcScope)) {
      continue;
    }

    // Skip the declaration line
    const isDeclLine = lineNum === declLineNum;

    // Check if this line reads the module-level variable
    if (!isModuleLevelRead(line, rule.variable, isDeclLine)) {
      continue;
    }

    // If a local shadow is active in this function, skip
    if (localShadowActive && typeof rule.variable !== 'string') {
      continue;
    }

    violations.push({
      file: rule.file,
      line: lineNum,
      text: line.trim(),
      variable: varName,
      enclosingFunction: funcScope,
    });
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('singleton access guard', () => {
  for (const rule of RULES) {
    const varLabel = typeof rule.variable === 'string'
      ? rule.variable
      : 'db';

    it(`${rule.file}: ${varLabel} only accessed in [${rule.allowedFunctions.join(', ')}]`, () => {
      const violations = checkRule(rule);

      if (violations.length > 0) {
        const details = violations
          .map(
            v =>
              `  line ${v.line} (in ${v.enclosingFunction ?? 'module scope'}): ${v.text}`,
          )
          .join('\n');
        expect.fail(
          `Direct reads of '${varLabel}' outside allowed functions in ${rule.file}:\n${details}\n\n` +
            `Use the getter function instead to ensure ALS scope isolation.`,
        );
      }
    });
  }

  it('all rule files exist', () => {
    for (const rule of RULES) {
      const filePath = path.join(CORE_ROOT, rule.file);
      expect(fs.existsSync(filePath), `Missing: ${rule.file}`).toBe(true);
    }
  });
});

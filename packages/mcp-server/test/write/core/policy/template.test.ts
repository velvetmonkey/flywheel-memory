/**
 * Template engine tests
 */

import { describe, it, expect } from 'vitest';
import {
  createContext,
  resolvePath,
  applyFilter,
  resolveExpression,
  interpolate,
  interpolateObject,
  extractExpressions,
  extractVariableRefs,
  hasTemplateExpressions,
  validateExpressions,
} from '../../../src/core/policy/template.js';

describe('createContext', () => {
  it('should create context with built-in values', () => {
    const ctx = createContext({ foo: 'bar' });

    expect(ctx.variables).toEqual({ foo: 'bar' });
    expect(ctx.conditions).toEqual({});
    expect(ctx.builtins.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(ctx.builtins.time).toMatch(/^\d{2}:\d{2}$/);
    expect(ctx.builtins.now).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('should create context with empty variables', () => {
    const ctx = createContext();
    expect(ctx.variables).toEqual({});
  });
});

describe('resolvePath', () => {
  it('should resolve simple paths', () => {
    expect(resolvePath({ name: 'test' }, 'name')).toBe('test');
  });

  it('should resolve nested paths', () => {
    const obj = { user: { name: 'Alice', address: { city: 'NYC' } } };
    expect(resolvePath(obj, 'user.name')).toBe('Alice');
    expect(resolvePath(obj, 'user.address.city')).toBe('NYC');
  });

  it('should resolve array indices', () => {
    const obj = { items: ['a', 'b', 'c'] };
    expect(resolvePath(obj, 'items.0')).toBe('a');
    expect(resolvePath(obj, 'items.2')).toBe('c');
  });

  it('should return undefined for missing paths', () => {
    expect(resolvePath({ a: 1 }, 'b')).toBeUndefined();
    expect(resolvePath({ a: { b: 1 } }, 'a.c')).toBeUndefined();
    expect(resolvePath(null, 'a')).toBeUndefined();
  });
});

describe('applyFilter', () => {
  it('should apply upper filter', () => {
    expect(applyFilter('hello', 'upper')).toBe('HELLO');
  });

  it('should apply lower filter', () => {
    expect(applyFilter('HELLO', 'lower')).toBe('hello');
  });

  it('should apply trim filter', () => {
    expect(applyFilter('  hello  ', 'trim')).toBe('hello');
  });

  it('should apply default filter', () => {
    expect(applyFilter(undefined, 'default', 'fallback')).toBe('fallback');
    expect(applyFilter('', 'default', 'fallback')).toBe('fallback');
    expect(applyFilter('value', 'default', 'fallback')).toBe('value');
  });

  it('should apply slug filter', () => {
    expect(applyFilter('Hello World', 'slug')).toBe('hello-world');
    expect(applyFilter('Test 123!', 'slug')).toBe('test-123');
  });

  it('should apply join filter to arrays', () => {
    expect(applyFilter(['a', 'b', 'c'], 'join')).toBe('a, b, c');
    expect(applyFilter(['a', 'b', 'c'], 'join', '-')).toBe('a-b-c');
  });

  it('should apply first/last filters', () => {
    expect(applyFilter(['a', 'b', 'c'], 'first')).toBe('a');
    expect(applyFilter(['a', 'b', 'c'], 'last')).toBe('c');
    expect(applyFilter('hello', 'first')).toBe('h');
    expect(applyFilter('hello', 'last')).toBe('o');
  });

  it('should return value for unknown filter', () => {
    expect(applyFilter('test', 'unknown')).toBe('test');
  });
});

describe('resolveExpression', () => {
  it('should resolve built-in values', () => {
    const ctx = createContext();
    expect(resolveExpression('today', ctx)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(resolveExpression('time', ctx)).toMatch(/^\d{2}:\d{2}$/);
  });

  it('should resolve variables', () => {
    const ctx = createContext({ name: 'test', nested: { value: 42 } });
    expect(resolveExpression('name', ctx)).toBe('test');
    expect(resolveExpression('nested.value', ctx)).toBe(42);
  });

  it('should resolve namespaced paths', () => {
    const ctx = createContext({ name: 'test' });
    ctx.conditions = { exists: true };
    expect(resolveExpression('variables.name', ctx)).toBe('test');
    expect(resolveExpression('conditions.exists', ctx)).toBe(true);
    expect(resolveExpression('builtins.today', ctx)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('should apply filters in expressions', () => {
    const ctx = createContext({ name: 'hello' });
    expect(resolveExpression('name | upper', ctx)).toBe('HELLO');
    expect(resolveExpression('missing | default(fallback)', ctx)).toBe('fallback');
  });
});

describe('interpolate', () => {
  it('should interpolate simple variables', () => {
    const ctx = createContext({ name: 'World' });
    expect(interpolate('Hello, {{name}}!', ctx)).toBe('Hello, World!');
  });

  it('should interpolate multiple variables', () => {
    const ctx = createContext({ first: 'John', last: 'Doe' });
    expect(interpolate('Name: {{first}} {{last}}', ctx)).toBe('Name: John Doe');
  });

  it('should interpolate with filters', () => {
    const ctx = createContext({ name: 'world' });
    expect(interpolate('Hello, {{name | upper}}!', ctx)).toBe('Hello, WORLD!');
  });

  it('should interpolate built-ins', () => {
    const ctx = createContext();
    const result = interpolate('Today is {{today}}', ctx);
    expect(result).toMatch(/Today is \d{4}-\d{2}-\d{2}/);
  });

  it('should leave unresolved expressions unchanged', () => {
    const ctx = createContext();
    expect(interpolate('Hello, {{unknown}}!', ctx)).toBe('Hello, {{unknown}}!');
  });

  it('should handle nested paths', () => {
    const ctx = createContext({ user: { name: 'Alice' } });
    expect(interpolate('User: {{user.name}}', ctx)).toBe('User: Alice');
  });
});

describe('interpolateObject', () => {
  it('should interpolate strings in objects', () => {
    const ctx = createContext({ name: 'test' });
    const obj = { path: '{{name}}.md', section: 'Log' };
    expect(interpolateObject(obj, ctx)).toEqual({ path: 'test.md', section: 'Log' });
  });

  it('should interpolate nested objects', () => {
    const ctx = createContext({ name: 'test' });
    const obj = { nested: { path: '{{name}}.md' } };
    expect(interpolateObject(obj, ctx)).toEqual({ nested: { path: 'test.md' } });
  });

  it('should interpolate arrays', () => {
    const ctx = createContext({ name: 'test' });
    const arr = ['{{name}}', '{{name}}.md'];
    expect(interpolateObject(arr, ctx)).toEqual(['test', 'test.md']);
  });

  it('should leave non-string values unchanged', () => {
    const ctx = createContext();
    const obj = { count: 42, flag: true, empty: null };
    expect(interpolateObject(obj, ctx)).toEqual({ count: 42, flag: true, empty: null });
  });
});

describe('extractExpressions', () => {
  it('should extract all expressions', () => {
    const template = 'Hello {{name}}, today is {{today}}';
    expect(extractExpressions(template)).toEqual(['name', 'today']);
  });

  it('should extract expressions with filters', () => {
    const template = '{{name | upper}} - {{value | default(none)}}';
    expect(extractExpressions(template)).toEqual(['name | upper', 'value | default(none)']);
  });

  it('should return empty array for no expressions', () => {
    expect(extractExpressions('Hello World')).toEqual([]);
  });
});

describe('extractVariableRefs', () => {
  it('should extract variable references', () => {
    const template = '{{name}} and {{path}}';
    expect(extractVariableRefs(template)).toEqual(['name', 'path']);
  });

  it('should exclude builtins', () => {
    const template = '{{name}} - {{today}}';
    expect(extractVariableRefs(template)).toEqual(['name']);
  });

  it('should exclude conditions', () => {
    const template = '{{name}} - {{conditions.exists}}';
    expect(extractVariableRefs(template)).toEqual(['name']);
  });

  it('should handle variables. prefix', () => {
    const template = '{{variables.name}}';
    expect(extractVariableRefs(template)).toEqual(['name']);
  });

  it('should extract first part of nested paths', () => {
    const template = '{{user.name}}';
    expect(extractVariableRefs(template)).toEqual(['user']);
  });
});

describe('hasTemplateExpressions', () => {
  it('should detect expressions', () => {
    expect(hasTemplateExpressions('Hello {{name}}')).toBe(true);
    expect(hasTemplateExpressions('Hello World')).toBe(false);
  });
});

describe('validateExpressions', () => {
  it('should validate resolved expressions', () => {
    const ctx = createContext({ name: 'test' });
    const result = validateExpressions('Hello {{name}}', ctx);
    expect(result.valid).toBe(true);
    expect(result.unresolved).toEqual([]);
  });

  it('should report unresolved expressions', () => {
    const ctx = createContext();
    const result = validateExpressions('Hello {{missing}}', ctx);
    expect(result.valid).toBe(false);
    expect(result.unresolved).toEqual(['missing']);
  });

  it('should validate builtins', () => {
    const ctx = createContext();
    const result = validateExpressions('Today: {{today}}', ctx);
    expect(result.valid).toBe(true);
  });
});

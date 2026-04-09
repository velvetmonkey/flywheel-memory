import { describe, it, expect } from 'vitest';
import { collectToolCatalog } from '/home/ben/src/flywheel-memory/packages/mcp-server/src/tools/toolCatalog.js';

describe('catalog check', () => {
  it('has graph/schema/insights', () => {
    const catalog = collectToolCatalog();
    console.log('Total:', catalog.size);
    console.log('Has graph:', catalog.has('graph'));
    console.log('Has schema:', catalog.has('schema'));
    console.log('Has insights:', catalog.has('insights'));
    expect(catalog.has('graph')).toBe(true);
  });
});

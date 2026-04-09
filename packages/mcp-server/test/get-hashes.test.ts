import { describe, it } from 'vitest';
import { collectToolCatalog } from '../src/tools/toolCatalog.js';

describe('get hashes', () => {
  it('prints hashes', () => {
    const catalog = collectToolCatalog();
    for (const name of ['schema', 'graph', 'insights']) {
      const entry = catalog.get(name);
      if (entry) {
        console.log(`${name}: category=${entry.category}, tier=${entry.tier}, hash=${entry.descriptionHash}`);
        console.log(`  rawDesc: ${entry.rawDescription.slice(0, 80)}`);
      } else {
        console.log(`${name}: NOT FOUND`);
      }
    }
  });
});

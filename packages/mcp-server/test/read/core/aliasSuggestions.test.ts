/**
 * Tests for suggestEntityAliases — generates candidate aliases (acronyms,
 * short forms) for entities and validates them against vault FTS5 content.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createTempVault,
  cleanupTempVault,
  openStateDb,
  deleteStateDb,
  type StateDb,
} from '../../helpers/testUtils.js';
import { suggestEntityAliases } from '../../../src/core/read/aliasSuggestions.js';

describe('suggestEntityAliases', () => {
  let vaultPath: string;
  let stateDb: StateDb;

  beforeEach(async () => {
    vaultPath = await createTempVault();
    stateDb = openStateDb(vaultPath);
  });

  afterEach(async () => {
    stateDb.db.close();
    deleteStateDb(vaultPath);
    await cleanupTempVault(vaultPath);
  });

  it('generates acronym for multi-word entity', () => {
    // Insert a multi-word entity
    stateDb.insertEntity.run(
      'Machine Learning', 'machine learning', 'tech/Machine Learning.md',
      'technologies', '[]', 5, null
    );

    // Populate FTS5 with a note mentioning the acronym "ML"
    stateDb.db.prepare(
      "INSERT INTO notes_fts (path, title, frontmatter, content) VALUES (?, ?, ?, ?)"
    ).run('test/note.md', 'Test Note', '', 'This note talks about ML and its applications.');

    const suggestions = suggestEntityAliases(stateDb);

    const mlSuggestion = suggestions.find(
      s => s.entity === 'Machine Learning' && s.candidate === 'ML'
    );
    expect(mlSuggestion).toBeDefined();
    expect(mlSuggestion!.type).toBe('acronym');
    expect(mlSuggestion!.mentions).toBeGreaterThanOrEqual(1);
  });

  it('generates short form for 3+ word entity', () => {
    // Insert a 3-word entity
    stateDb.insertEntity.run(
      'Natural Language Processing', 'natural language processing',
      'tech/Natural Language Processing.md', 'technologies', '[]', 5, null
    );

    // Populate FTS5 with a note mentioning the first word "Natural"
    stateDb.db.prepare(
      "INSERT INTO notes_fts (path, title, frontmatter, content) VALUES (?, ?, ?, ?)"
    ).run('test/note.md', 'Test Note', '', 'Natural approaches to text analysis are powerful.');

    const suggestions = suggestEntityAliases(stateDb);

    const shortFormSuggestion = suggestions.find(
      s => s.entity === 'Natural Language Processing' && s.candidate === 'Natural' && s.type === 'short_form'
    );
    expect(shortFormSuggestion).toBeDefined();
    expect(shortFormSuggestion!.type).toBe('short_form');
  });

  it('empty entities returns empty array', () => {
    // No entities inserted, just call the function
    const suggestions = suggestEntityAliases(stateDb);
    expect(suggestions).toEqual([]);
  });

  it('skips candidates that match existing entity names', () => {
    // Insert "AI" as its own entity
    stateDb.insertEntity.run(
      'AI', 'ai', 'glossary/AI.md', 'acronyms', '[]', 3, null
    );

    // Insert "Artificial Intelligence" which would generate "AI" as acronym
    stateDb.insertEntity.run(
      'Artificial Intelligence', 'artificial intelligence',
      'tech/Artificial Intelligence.md', 'technologies', '["AI"]', 5, null
    );

    // Populate FTS5 with notes mentioning "AI" heavily
    stateDb.db.prepare(
      "INSERT INTO notes_fts (path, title, frontmatter, content) VALUES (?, ?, ?, ?)"
    ).run('test/note1.md', 'AI Note', '', 'AI is transforming the world. AI everywhere.');
    stateDb.db.prepare(
      "INSERT INTO notes_fts (path, title, frontmatter, content) VALUES (?, ?, ?, ?)"
    ).run('test/note2.md', 'More AI', '', 'More about AI and its impact.');

    const suggestions = suggestEntityAliases(stateDb);

    // "AI" should NOT appear as a suggestion for "Artificial Intelligence"
    // because (a) it already exists as an entity name, and (b) it's already an alias
    const aiSuggestion = suggestions.find(
      s => s.entity === 'Artificial Intelligence' && s.candidate === 'AI'
    );
    expect(aiSuggestion).toBeUndefined();
  });

  it('folder filter works', () => {
    // Insert entities in different folders
    stateDb.insertEntity.run(
      'Machine Learning', 'machine learning', 'tech/Machine Learning.md',
      'technologies', '[]', 5, null
    );
    stateDb.insertEntity.run(
      'Deep Learning', 'deep learning', 'research/Deep Learning.md',
      'concepts', '[]', 3, null
    );

    // Populate FTS5 with notes mentioning both acronyms
    stateDb.db.prepare(
      "INSERT INTO notes_fts (path, title, frontmatter, content) VALUES (?, ?, ?, ?)"
    ).run('test/note.md', 'Test Note', '', 'ML and DL are popular acronyms in the field.');

    // Filter to only "tech" folder
    const suggestions = suggestEntityAliases(stateDb, 'tech');

    // Should include Machine Learning (in tech/) but not Deep Learning (in research/)
    const mlSuggestion = suggestions.find(s => s.entity === 'Machine Learning');
    expect(mlSuggestion).toBeDefined();

    const dlSuggestion = suggestions.find(s => s.entity === 'Deep Learning');
    expect(dlSuggestion).toBeUndefined();
  });
});

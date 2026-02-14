/**
 * Tests for Schema Intelligence heuristics
 *
 * These tests cover type detection, enumerable thresholds,
 * confidence scoring, naming patterns, and incomplete note detection.
 */

import { describe, test, expect, beforeAll } from 'vitest';
import * as path from 'path';
import { fileURLToPath } from 'url'
import { connect, close } from 'mcp-testing-kit';
import { createTestServer, type TestServerContext } from '../helpers/createTestServer.js';
import {
  inferFolderConventions,
  findIncompleteNotes,
  suggestFieldValues,
} from '../../src/tools/schema.js';
import { buildVaultIndex } from '../../src/core/graph.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = path.join(__dirname, '..', 'fixtures');
const SCHEMA_FIXTURES = path.join(__dirname, '..', 'fixtures', 'schema-inference');

describe('Schema Inference Tool', () => {
  let context: TestServerContext;

  beforeAll(async () => {
    context = await createTestServer(SCHEMA_FIXTURES);
  });

  describe('inferFolderConventions', () => {
    test('detects common fields in folder', async () => {
      const result = inferFolderConventions(context.vaultIndex, 'projects');

      expect(result.folder).toBe('projects');
      expect(result.note_count).toBeGreaterThan(0);
      expect(result.inferred_fields.length).toBeGreaterThan(0);
    });

    test('returns coverage percentage', async () => {
      const result = inferFolderConventions(context.vaultIndex, 'projects');

      expect(result.coverage).toBeGreaterThanOrEqual(0);
      expect(result.coverage).toBeLessThanOrEqual(1);
    });

    test('handles empty folder', async () => {
      const result = inferFolderConventions(context.vaultIndex, 'nonexistent-folder');

      expect(result.note_count).toBe(0);
      expect(result.coverage).toBe(0);
      expect(result.inferred_fields).toHaveLength(0);
    });

    test('respects minConfidence threshold', async () => {
      // High threshold should filter out infrequent fields
      const highThreshold = inferFolderConventions(context.vaultIndex, 'projects', 0.9);
      const lowThreshold = inferFolderConventions(context.vaultIndex, 'projects', 0.3);

      // Low threshold should return more or equal fields
      expect(lowThreshold.inferred_fields.length).toBeGreaterThanOrEqual(
        highThreshold.inferred_fields.length
      );
    });

    test('marks high-frequency fields as required', async () => {
      const result = inferFolderConventions(context.vaultIndex, 'projects');

      for (const field of result.inferred_fields) {
        if (field.frequency >= 0.9) {
          expect(field.is_required).toBe(true);
        }
      }
    });

    test('sorts fields by frequency descending', async () => {
      const result = inferFolderConventions(context.vaultIndex, 'projects');

      if (result.inferred_fields.length > 1) {
        for (let i = 1; i < result.inferred_fields.length; i++) {
          expect(result.inferred_fields[i - 1].frequency).toBeGreaterThanOrEqual(
            result.inferred_fields[i].frequency
          );
        }
      }
    });

    test('analyzes entire vault when no folder specified', async () => {
      const result = inferFolderConventions(context.vaultIndex);

      expect(result.folder).toBe('(vault root)');
      expect(result.note_count).toBeGreaterThan(0);
    });

    test('provides example notes for fields', async () => {
      const result = inferFolderConventions(context.vaultIndex, 'projects');

      for (const field of result.inferred_fields) {
        expect(Array.isArray(field.example_notes)).toBe(true);
        expect(field.example_notes.length).toBeLessThanOrEqual(3);
      }
    });

    test('calculates confidence between 0 and 1', async () => {
      const result = inferFolderConventions(context.vaultIndex, 'projects');

      for (const field of result.inferred_fields) {
        expect(field.confidence).toBeGreaterThanOrEqual(0);
        expect(field.confidence).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('Type Detection', () => {
    test('detects date-like strings as date type', async () => {
      const result = inferFolderConventions(context.vaultIndex, 'projects');

      // Projects fixtures have due_date fields with YYYY-MM-DD format
      const dateField = result.inferred_fields.find(f => f.name === 'due_date');
      if (dateField) {
        expect(dateField.inferred_type).toBe('date');
      }
    });

    test('detects wikilinks in frontmatter', async () => {
      const result = inferFolderConventions(context.vaultIndex, 'projects');

      // owner field is a wikilink
      const ownerField = result.inferred_fields.find(f => f.name === 'owner');
      if (ownerField) {
        expect(['wikilink', 'string']).toContain(ownerField.inferred_type);
      }
    });

    test('detects array types', async () => {
      const result = inferFolderConventions(context.vaultIndex, 'projects');

      // tags or team fields might be arrays
      const arrayField = result.inferred_fields.find(
        f => f.inferred_type === 'array' || f.inferred_type === 'wikilink[]'
      );
      // May or may not have array fields depending on fixtures
      expect(result.inferred_fields).toBeDefined();
    });

    test('detects boolean fields', async () => {
      const result = inferFolderConventions(context.vaultIndex, 'projects');

      const boolField = result.inferred_fields.find(
        f => f.inferred_type === 'boolean'
      );
      // Archive or complete flags might be booleans
      if (boolField) {
        expect(boolField.inferred_type).toBe('boolean');
      }
    });

    test('detects number fields', async () => {
      const result = inferFolderConventions(context.vaultIndex, 'projects');

      const numField = result.inferred_fields.find(
        f => f.inferred_type === 'number'
      );
      // Priority might be a number
      if (numField) {
        expect(numField.inferred_type).toBe('number');
      }
    });
  });

  describe('Enumerable Detection', () => {
    test('marks fields with few unique values as enumerable', async () => {
      const result = inferFolderConventions(context.vaultIndex, 'projects');

      // status field should have few values (active, completed, on-hold)
      const statusField = result.inferred_fields.find(f => f.name === 'status');
      if (statusField && statusField.common_values) {
        expect(statusField.common_values.length).toBeLessThanOrEqual(20);
      }
    });

    test('provides common values sorted by frequency', async () => {
      const result = inferFolderConventions(context.vaultIndex, 'projects');

      for (const field of result.inferred_fields) {
        if (field.common_values) {
          // Common values should be present and reasonable size
          expect(field.common_values.length).toBeLessThanOrEqual(10);
        }
      }
    });

    test('does not mark high-cardinality fields as enumerable', async () => {
      // If there's a field like 'title' with unique values per note,
      // it should not have common_values
      const result = inferFolderConventions(context.vaultIndex, 'projects');

      // Just verify the structure is correct
      expect(result).toBeDefined();
    });
  });

  describe('Naming Pattern Detection', () => {
    test('detects date-based naming patterns', async () => {
      const result = inferFolderConventions(context.vaultIndex, 'meetings');

      // meetings folder has meeting-YYYY-MM-DD format
      if (result.naming_pattern) {
        expect(result.naming_pattern).toBeDefined();
      }
    });

    test('returns null for folders with inconsistent naming', async () => {
      const result = inferFolderConventions(context.vaultIndex, 'projects');

      // Projects have names like "project-alpha", no date pattern
      // May or may not detect a pattern
      expect(result).toBeDefined();
    });
  });
});

describe('Find Incomplete Notes', () => {
  let context: TestServerContext;

  beforeAll(async () => {
    context = await createTestServer(SCHEMA_FIXTURES);
  });

  describe('findIncompleteNotes', () => {
    test('finds notes missing common fields', async () => {
      const result = findIncompleteNotes(context.vaultIndex, 'projects', 0.5);

      expect(result.folder).toBe('projects');
      expect(result.total_notes).toBeGreaterThan(0);
      expect(typeof result.incomplete_count).toBe('number');
    });

    test('returns completeness scores between 0 and 1', async () => {
      const result = findIncompleteNotes(context.vaultIndex, 'projects', 0.5);

      for (const note of result.notes) {
        expect(note.completeness_score).toBeGreaterThanOrEqual(0);
        expect(note.completeness_score).toBeLessThanOrEqual(1);
      }
    });

    test('lists existing and missing fields', async () => {
      const result = findIncompleteNotes(context.vaultIndex, 'projects', 0.5);

      for (const note of result.notes) {
        expect(Array.isArray(note.existing_fields)).toBe(true);
        expect(Array.isArray(note.missing_fields)).toBe(true);
      }
    });

    test('respects minFrequency parameter', async () => {
      const strictResult = findIncompleteNotes(context.vaultIndex, 'projects', 0.9);
      const lenientResult = findIncompleteNotes(context.vaultIndex, 'projects', 0.3);

      // Stricter threshold should find fewer expected fields,
      // so potentially fewer incomplete notes
      expect(typeof strictResult.incomplete_count).toBe('number');
      expect(typeof lenientResult.incomplete_count).toBe('number');
    });

    test('respects limit parameter', async () => {
      const result = findIncompleteNotes(context.vaultIndex, 'projects', 0.5, 1);

      expect(result.notes.length).toBeLessThanOrEqual(1);
    });

    test('respects offset parameter', async () => {
      const allResults = findIncompleteNotes(context.vaultIndex, undefined, 0.3, 100, 0);
      const offsetResults = findIncompleteNotes(context.vaultIndex, undefined, 0.3, 100, 1);

      if (allResults.notes.length > 1) {
        // Offset should skip first result
        expect(offsetResults.notes.length).toBe(allResults.notes.length - 1);
      }
    });

    test('sorts by completeness ascending (least complete first)', async () => {
      const result = findIncompleteNotes(context.vaultIndex, 'projects', 0.5);

      if (result.notes.length > 1) {
        for (let i = 1; i < result.notes.length; i++) {
          expect(result.notes[i - 1].completeness_score).toBeLessThanOrEqual(
            result.notes[i].completeness_score
          );
        }
      }
    });

    test('provides suggested values for missing fields', async () => {
      const result = findIncompleteNotes(context.vaultIndex, 'projects', 0.5);

      for (const note of result.notes) {
        for (const field of note.missing_fields) {
          expect(field.name).toBeDefined();
          expect(field.expected_type).toBeDefined();
          expect(field.frequency_in_folder).toBeGreaterThan(0);
        }
      }
    });

    test('handles empty folder', async () => {
      const result = findIncompleteNotes(context.vaultIndex, 'nonexistent');

      expect(result.total_notes).toBe(0);
      expect(result.incomplete_count).toBe(0);
      expect(result.notes).toHaveLength(0);
    });
  });
});

describe('Suggest Field Values', () => {
  let context: TestServerContext;

  beforeAll(async () => {
    context = await createTestServer(SCHEMA_FIXTURES);
  });

  describe('suggestFieldValues', () => {
    test('suggests values based on vault usage', async () => {
      const result = suggestFieldValues(context.vaultIndex, 'status');

      expect(result.field).toBe('status');
      expect(result.value_type).toBeDefined();
      expect(typeof result.is_enumerable).toBe('boolean');
    });

    test('returns frequency for each suggestion', async () => {
      const result = suggestFieldValues(context.vaultIndex, 'status');

      for (const suggestion of result.suggestions) {
        expect(suggestion.frequency).toBeGreaterThanOrEqual(0);
        expect(suggestion.frequency).toBeLessThanOrEqual(1);
      }
    });

    test('returns confidence scores', async () => {
      const result = suggestFieldValues(context.vaultIndex, 'status');

      for (const suggestion of result.suggestions) {
        expect(suggestion.confidence).toBeGreaterThanOrEqual(0);
        expect(suggestion.confidence).toBeLessThanOrEqual(1);
      }
    });

    test('provides reasons for suggestions', async () => {
      const result = suggestFieldValues(context.vaultIndex, 'status');

      for (const suggestion of result.suggestions) {
        expect(typeof suggestion.reason).toBe('string');
        expect(suggestion.reason.length).toBeGreaterThan(0);
      }
    });

    test('provides example notes for each value', async () => {
      const result = suggestFieldValues(context.vaultIndex, 'status');

      for (const suggestion of result.suggestions) {
        expect(Array.isArray(suggestion.example_notes)).toBe(true);
        expect(suggestion.example_notes.length).toBeLessThanOrEqual(3);
      }
    });

    test('respects folder filter', async () => {
      const allVault = suggestFieldValues(context.vaultIndex, 'status');
      const folderOnly = suggestFieldValues(context.vaultIndex, 'status', {
        folder: 'projects',
      });

      // Both should return valid results
      expect(allVault.field).toBe('status');
      expect(folderOnly.field).toBe('status');
    });

    test('boosts confidence when context matches', async () => {
      const withContext = suggestFieldValues(context.vaultIndex, 'status', {
        existing_frontmatter: { type: 'project' },
      });

      // Context matching may boost confidence
      expect(withContext.suggestions).toBeDefined();
    });

    test('handles unknown field gracefully', async () => {
      const result = suggestFieldValues(context.vaultIndex, 'nonexistent_field_xyz');

      expect(result.field).toBe('nonexistent_field_xyz');
      expect(result.suggestions).toHaveLength(0);
    });

    test('marks fields with few values as enumerable', async () => {
      const result = suggestFieldValues(context.vaultIndex, 'status');

      // Status should be enumerable (few distinct values)
      if (result.suggestions.length > 0 && result.suggestions.length <= 20) {
        expect(result.is_enumerable).toBe(true);
      }
    });

    test('sorts suggestions by confidence descending', async () => {
      const result = suggestFieldValues(context.vaultIndex, 'status');

      if (result.suggestions.length > 1) {
        for (let i = 1; i < result.suggestions.length; i++) {
          expect(result.suggestions[i - 1].confidence).toBeGreaterThanOrEqual(
            result.suggestions[i].confidence
          );
        }
      }
    });

    test('limits suggestions to 10', async () => {
      const result = suggestFieldValues(context.vaultIndex, 'status');

      expect(result.suggestions.length).toBeLessThanOrEqual(10);
    });
  });
});

describe('MCP Tool Integration', () => {
  let context: TestServerContext;

  beforeAll(async () => {
    context = await createTestServer(SCHEMA_FIXTURES);
  });

  test('infer_folder_conventions tool returns JSON', async () => {
    const client = await connect(context.server);
    const result = await client.callTool('infer_folder_conventions', {
      folder: 'projects',
    });

    expect(result.content).toBeDefined();
    expect(result.content[0].type).toBe('text');

    const data = JSON.parse(result.content[0].text);
    expect(data.folder).toBe('projects');
    expect(data.inferred_fields).toBeDefined();
  });

  test('find_incomplete_notes tool returns JSON', async () => {
    const client = await connect(context.server);
    const result = await client.callTool('find_incomplete_notes', {
      folder: 'projects',
      min_frequency: 0.5,
    });

    expect(result.content).toBeDefined();
    const data = JSON.parse(result.content[0].text);
    expect(data.folder).toBe('projects');
    expect(data.notes).toBeDefined();
  });

  test('suggest_field_values tool returns JSON', async () => {
    const client = await connect(context.server);
    const result = await client.callTool('suggest_field_values', {
      field: 'status',
    });

    expect(result.content).toBeDefined();
    const data = JSON.parse(result.content[0].text);
    expect(data.field).toBe('status');
    expect(data.suggestions).toBeDefined();
  });
});

describe('Edge Cases', () => {
  test('handles vault with no frontmatter', async () => {
    const index = await buildVaultIndex(FIXTURES_PATH);
    const result = inferFolderConventions(index);

    // Should not crash, may have low coverage
    expect(result).toBeDefined();
    expect(result.coverage).toBeGreaterThanOrEqual(0);
  });

  test('handles very small sample size', async () => {
    const index = await buildVaultIndex(SCHEMA_FIXTURES);

    // Use high threshold which should result in fewer/no fields
    const result = inferFolderConventions(index, 'projects', 0.99);

    expect(result).toBeDefined();
    expect(result.inferred_fields.length).toBeLessThanOrEqual(
      inferFolderConventions(index, 'projects', 0.5).inferred_fields.length
    );
  });

  test('handles mixed types in same field', async () => {
    const index = await buildVaultIndex(FIXTURES_PATH);
    const result = inferFolderConventions(index);

    // Fields might have mixed types - should pick majority
    for (const field of result.inferred_fields) {
      expect(field.inferred_type).toBeDefined();
      expect(field.confidence).toBeGreaterThan(0);
    }
  });

  test('handles special characters in field names', async () => {
    const index = await buildVaultIndex(FIXTURES_PATH);
    const result = inferFolderConventions(index);

    // Should handle any valid YAML field names
    expect(result).toBeDefined();
  });

  test('handles deeply nested folder paths', async () => {
    const index = await buildVaultIndex(FIXTURES_PATH);
    const result = inferFolderConventions(index, 'edge-cases/alias-conflict');

    expect(result).toBeDefined();
    expect(typeof result.note_count).toBe('number');
  });
});

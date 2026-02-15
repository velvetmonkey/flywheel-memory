/**
 * Schema Intelligence Tools
 *
 * Inferred-only schema system - auto-detect conventions from vault patterns.
 * Zero configuration, smart defaults, actionable output.
 */

import type { VaultIndex, VaultNote, Backlink } from '../../core/read/types.js';

// =============================================================================
// TYPES
// =============================================================================

/** Inferred field information per folder */
export interface InferredField {
  name: string;
  frequency: number;           // 0.0-1.0, how often present in folder
  inferred_type: string;       // 'string' | 'number' | 'boolean' | 'date' | 'array' | 'wikilink'
  is_required: boolean;        // true if frequency > 0.9
  common_values: unknown[] | null;  // If enumerable (<20 unique values)
  example_notes: string[];     // Up to 3 examples for context
  confidence: number;          // How confident the inference is
}

/** Computed field suggestion */
export interface ComputedFieldSuggestion {
  name: string;
  description: string;
  sample_value: unknown;
}

/** Result of convention inference */
export interface InferredConventions {
  folder: string;
  note_count: number;
  coverage: number;            // % of notes with frontmatter
  inferred_fields: InferredField[];
  computed_field_suggestions: ComputedFieldSuggestion[];
  naming_pattern: string | null;
}

/** A missing field suggestion */
export interface MissingField {
  name: string;
  expected_type: string;
  frequency_in_folder: number;
  suggested_value: unknown | null;
  suggestion_source: 'prose_pattern' | 'similar_notes' | 'default' | null;
}

/** An incomplete note with missing fields */
export interface IncompleteNote {
  path: string;
  existing_fields: string[];
  missing_fields: MissingField[];
  completeness_score: number;  // 0.0-1.0
}

/** Result of incomplete notes search */
export interface IncompleteNotesResult {
  folder: string | null;
  total_notes: number;
  incomplete_count: number;
  notes: IncompleteNote[];
}

/** Field value suggestion with context */
export interface ValueSuggestion {
  value: unknown;
  frequency: number;           // How often used
  confidence: number;          // Based on context match
  reason: string;              // Why suggested
  example_notes: string[];     // Notes with this value
}

/** Result of value suggestions */
export interface FieldValueSuggestions {
  field: string;
  suggestions: ValueSuggestion[];
  value_type: string;          // Inferred type
  is_enumerable: boolean;      // If <20 unique values, likely enum
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get the type of a value with more detail than typeof
 */
function getValueType(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) {
    // Check if array contains wikilinks
    if (value.some(v => typeof v === 'string' && /^\[\[.+\]\]$/.test(v))) {
      return 'wikilink[]';
    }
    return 'array';
  }
  if (typeof value === 'string') {
    // Check for wikilink
    if (/^\[\[.+\]\]$/.test(value)) return 'wikilink';
    // Check for date-like strings
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return 'date';
  }
  if (value instanceof Date) return 'date';
  return typeof value;
}

/**
 * Get folder from path
 */
function getFolder(notePath: string): string {
  const lastSlash = notePath.lastIndexOf('/');
  return lastSlash === -1 ? '' : notePath.substring(0, lastSlash);
}

/**
 * Get notes in a specific folder (or all notes if no folder)
 */
function getNotesInFolder(index: VaultIndex, folder?: string): VaultNote[] {
  const notes: VaultNote[] = [];
  for (const note of index.notes.values()) {
    if (!folder || note.path.startsWith(folder + '/') || getFolder(note.path) === folder) {
      notes.push(note);
    }
  }
  return notes;
}

/**
 * Detect naming pattern from file names
 */
function detectNamingPattern(notes: VaultNote[]): string | null {
  if (notes.length < 3) return null;

  const filenames = notes.map(n => {
    const lastSlash = n.path.lastIndexOf('/');
    return lastSlash === -1 ? n.path : n.path.substring(lastSlash + 1);
  });

  // Check for date patterns
  const datePattern = /^\d{4}-\d{2}-\d{2}/;
  const dateMatches = filenames.filter(f => datePattern.test(f));
  if (dateMatches.length / filenames.length > 0.8) {
    // Check if there's a suffix pattern
    const suffixes = dateMatches.map(f => f.replace(/^\d{4}-\d{2}-\d{2}/, ''));
    const uniqueSuffixes = new Set(suffixes);
    if (uniqueSuffixes.size === 1) {
      return `YYYY-MM-DD${Array.from(uniqueSuffixes)[0]}`;
    }
    return 'YYYY-MM-DD *.md';
  }

  // Check for prefix patterns (ADR-001, etc.)
  const prefixPattern = /^([A-Z]+-)\d+/;
  const prefixMatches = filenames.filter(f => prefixPattern.test(f));
  if (prefixMatches.length / filenames.length > 0.8) {
    const match = filenames[0].match(prefixPattern);
    if (match) {
      return `${match[1]}### *.md`;
    }
  }

  return null;
}

// =============================================================================
// CORE FUNCTIONS
// =============================================================================

/**
 * Infer conventions from a folder based on existing notes
 */
export function inferFolderConventions(
  index: VaultIndex,
  folder?: string,
  minConfidence: number = 0.5
): InferredConventions {
  const notes = getNotesInFolder(index, folder);
  const totalNotes = notes.length;

  if (totalNotes === 0) {
    return {
      folder: folder || '(vault root)',
      note_count: 0,
      coverage: 0,
      inferred_fields: [],
      computed_field_suggestions: [],
      naming_pattern: null,
    };
  }

  // Count notes with frontmatter
  const notesWithFrontmatter = notes.filter(
    n => n.frontmatter && Object.keys(n.frontmatter).length > 0
  );
  const coverage = notesWithFrontmatter.length / totalNotes;

  // Analyze field frequency and types
  const fieldStats = new Map<string, {
    count: number;
    types: Map<string, number>;
    values: Map<string, number>;
    examples: string[];
  }>();

  for (const note of notes) {
    for (const [key, value] of Object.entries(note.frontmatter)) {
      if (!fieldStats.has(key)) {
        fieldStats.set(key, {
          count: 0,
          types: new Map(),
          values: new Map(),
          examples: [],
        });
      }

      const stats = fieldStats.get(key)!;
      stats.count++;

      const type = getValueType(value);
      stats.types.set(type, (stats.types.get(type) || 0) + 1);

      // Track values for enum detection
      const valueStr = JSON.stringify(value);
      stats.values.set(valueStr, (stats.values.get(valueStr) || 0) + 1);

      // Store examples
      if (stats.examples.length < 3) {
        stats.examples.push(note.path);
      }
    }
  }

  // Build inferred fields
  const inferredFields: InferredField[] = [];

  for (const [name, stats] of fieldStats) {
    const frequency = stats.count / totalNotes;

    // Skip low frequency fields below confidence threshold
    if (frequency < minConfidence) continue;

    // Determine primary type
    let primaryType = 'string';
    let maxTypeCount = 0;
    for (const [type, count] of stats.types) {
      if (count > maxTypeCount) {
        maxTypeCount = count;
        primaryType = type;
      }
    }

    // Determine if enumerable (< 20 unique values and < 50% cardinality)
    const uniqueValues = stats.values.size;
    const isEnumerable = uniqueValues <= 20 && uniqueValues / stats.count < 0.5;

    // Get common values if enumerable
    let commonValues: unknown[] | null = null;
    if (isEnumerable) {
      const sortedValues = Array.from(stats.values.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);
      commonValues = sortedValues.map(([v]) => JSON.parse(v));
    }

    // Calculate confidence based on type consistency
    const typeConsistency = maxTypeCount / stats.count;
    const confidence = Math.min(1, frequency * typeConsistency);

    inferredFields.push({
      name,
      frequency,
      inferred_type: primaryType,
      is_required: frequency >= 0.9,
      common_values: commonValues,
      example_notes: stats.examples,
      confidence,
    });
  }

  // Sort by frequency (most common first)
  inferredFields.sort((a, b) => b.frequency - a.frequency);

  // Suggest computed fields
  const computedSuggestions: ComputedFieldSuggestion[] = [];

  // Check if word_count might be useful
  const hasWordCount = fieldStats.has('word_count');
  if (!hasWordCount && notes.length > 5) {
    computedSuggestions.push({
      name: 'word_count',
      description: 'Number of words in note body',
      sample_value: 500,
    });
  }

  // Check if link_count might be useful
  const hasLinkCount = fieldStats.has('link_count');
  if (!hasLinkCount && notes.some(n => n.outlinks.length > 0)) {
    computedSuggestions.push({
      name: 'link_count',
      description: 'Number of outgoing wikilinks',
      sample_value: notes[0]?.outlinks.length || 0,
    });
  }

  // Detect naming pattern
  const namingPattern = detectNamingPattern(notes);

  return {
    folder: folder || '(vault root)',
    note_count: totalNotes,
    coverage,
    inferred_fields: inferredFields,
    computed_field_suggestions: computedSuggestions,
    naming_pattern: namingPattern,
  };
}

/**
 * Find notes missing expected fields based on inferred conventions
 */
export function findIncompleteNotes(
  index: VaultIndex,
  folder?: string,
  minFrequency: number = 0.7,
  limit: number = 50,
  offset: number = 0
): IncompleteNotesResult {
  // First, infer conventions
  const conventions = inferFolderConventions(index, folder, minFrequency);
  const notes = getNotesInFolder(index, folder);

  // Get fields that should be present (frequency >= minFrequency)
  const expectedFields = conventions.inferred_fields.filter(
    f => f.frequency >= minFrequency
  );

  if (expectedFields.length === 0) {
    return {
      folder: folder || null,
      total_notes: notes.length,
      incomplete_count: 0,
      notes: [],
    };
  }

  // Find incomplete notes
  const incompleteNotes: IncompleteNote[] = [];

  for (const note of notes) {
    const existingFields = Object.keys(note.frontmatter);
    const missingFields: MissingField[] = [];

    for (const expected of expectedFields) {
      if (!existingFields.includes(expected.name)) {
        // Try to suggest a value
        let suggestedValue: unknown | null = null;
        let suggestionSource: 'prose_pattern' | 'similar_notes' | 'default' | null = null;

        // If field has common values, suggest the most common one
        if (expected.common_values && expected.common_values.length > 0) {
          suggestedValue = expected.common_values[0];
          suggestionSource = 'similar_notes';
        }

        missingFields.push({
          name: expected.name,
          expected_type: expected.inferred_type,
          frequency_in_folder: expected.frequency,
          suggested_value: suggestedValue,
          suggestion_source: suggestionSource,
        });
      }
    }

    if (missingFields.length > 0) {
      const completeness = 1 - (missingFields.length / expectedFields.length);
      incompleteNotes.push({
        path: note.path,
        existing_fields: existingFields,
        missing_fields: missingFields,
        completeness_score: Math.round(completeness * 100) / 100,
      });
    }
  }

  // Sort by completeness (least complete first)
  incompleteNotes.sort((a, b) => a.completeness_score - b.completeness_score);

  // Apply pagination
  const paginatedNotes = incompleteNotes.slice(offset, offset + limit);

  return {
    folder: folder || null,
    total_notes: notes.length,
    incomplete_count: incompleteNotes.length,
    notes: paginatedNotes,
  };
}

/**
 * Suggest field values based on vault usage and context
 */
export function suggestFieldValues(
  index: VaultIndex,
  field: string,
  context?: {
    folder?: string;
    existing_frontmatter?: Record<string, unknown>;
  }
): FieldValueSuggestions {
  const notes = context?.folder
    ? getNotesInFolder(index, context.folder)
    : Array.from(index.notes.values());

  // Collect all values for this field
  const valueStats = new Map<string, {
    value: unknown;
    count: number;
    notes: string[];
  }>();

  let totalWithField = 0;
  let primaryType = 'string';
  const typeCounts = new Map<string, number>();

  for (const note of notes) {
    const value = note.frontmatter[field];
    if (value === undefined) continue;

    totalWithField++;

    const type = getValueType(value);
    typeCounts.set(type, (typeCounts.get(type) || 0) + 1);

    // Handle arrays - count each element
    const values = Array.isArray(value) ? value : [value];

    for (const v of values) {
      const key = JSON.stringify(v);

      if (!valueStats.has(key)) {
        valueStats.set(key, {
          value: v,
          count: 0,
          notes: [],
        });
      }

      const stats = valueStats.get(key)!;
      stats.count++;
      if (stats.notes.length < 3) {
        stats.notes.push(note.path);
      }
    }
  }

  // Determine primary type
  let maxTypeCount = 0;
  for (const [type, count] of typeCounts) {
    if (count > maxTypeCount) {
      maxTypeCount = count;
      primaryType = type;
    }
  }

  // Build suggestions sorted by frequency
  const suggestions: ValueSuggestion[] = Array.from(valueStats.values())
    .map(stats => {
      const frequency = stats.count / totalWithField;
      let confidence = frequency;
      let reason = `Used ${stats.count} times (${Math.round(frequency * 100)}%)`;

      // Boost confidence if context matches
      if (context?.existing_frontmatter) {
        // Check if notes with this value share other frontmatter fields
        for (const notePath of stats.notes) {
          const note = index.notes.get(notePath);
          if (!note) continue;

          for (const [key, value] of Object.entries(context.existing_frontmatter)) {
            if (key !== field && JSON.stringify(note.frontmatter[key]) === JSON.stringify(value)) {
              confidence = Math.min(1, confidence + 0.1);
              reason = `Common when ${key}=${JSON.stringify(value)}`;
              break;
            }
          }
        }
      }

      return {
        value: stats.value,
        frequency,
        confidence,
        reason,
        example_notes: stats.notes,
      };
    })
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 10);

  const isEnumerable = valueStats.size <= 20;

  return {
    field,
    suggestions,
    value_type: primaryType,
    is_enumerable: isEnumerable,
  };
}

// =============================================================================
// CONTRADICTION DETECTION
// =============================================================================

/** Fields that are expected to differ across notes and should be skipped */
const SKIP_CONTRADICTION_FIELDS = new Set([
  'title', 'created', 'modified', 'path', 'aliases', 'tags',
  'date', 'updated', 'word_count', 'link_count',
]);

/** A contradiction found across notes referencing the same entity */
export interface Contradiction {
  entity: string;
  field: string;
  values: { value: unknown; notes: string[] }[];
}

/**
 * Find contradictions in frontmatter across notes that reference the same entity.
 * For each entity, find all notes that link to it, then compare their frontmatter
 * field values and report conflicts.
 */
export function findContradictions(
  index: VaultIndex,
  entity?: string,
): Contradiction[] {
  const contradictions: Contradiction[] = [];

  // Determine which entities to check
  const entitiesToCheck: [string, string][] = [];
  if (entity) {
    const normalized = entity.toLowerCase();
    const entityPath = index.entities.get(normalized);
    if (entityPath) {
      entitiesToCheck.push([normalized, entityPath]);
    }
  } else {
    for (const [name, entityPath] of index.entities) {
      entitiesToCheck.push([name, entityPath]);
    }
  }

  for (const [entityName, _entityPath] of entitiesToCheck) {
    // Find all notes that link to this entity
    const backlinks = index.backlinks.get(entityName);
    if (!backlinks || backlinks.length < 2) continue;

    // Get unique source note paths
    const sourcePaths = [...new Set(backlinks.map(bl => bl.source))];
    if (sourcePaths.length < 2) continue;

    // Collect frontmatter from all source notes
    const notesFrontmatter: { path: string; fm: Record<string, unknown> }[] = [];
    for (const srcPath of sourcePaths) {
      const note = index.notes.get(srcPath);
      if (note && Object.keys(note.frontmatter).length > 0) {
        notesFrontmatter.push({ path: srcPath, fm: note.frontmatter });
      }
    }

    if (notesFrontmatter.length < 2) continue;

    // Collect all fields across these notes
    const allFields = new Set<string>();
    for (const { fm } of notesFrontmatter) {
      for (const key of Object.keys(fm)) {
        if (!SKIP_CONTRADICTION_FIELDS.has(key)) {
          allFields.add(key);
        }
      }
    }

    // For each field, check for conflicting values
    for (const field of allFields) {
      const valueMap = new Map<string, string[]>(); // serialized value -> note paths

      for (const { path: notePath, fm } of notesFrontmatter) {
        if (fm[field] === undefined) continue;
        const key = JSON.stringify(fm[field]);
        if (!valueMap.has(key)) {
          valueMap.set(key, []);
        }
        valueMap.get(key)!.push(notePath);
      }

      // Only report if there are 2+ distinct values
      if (valueMap.size >= 2) {
        contradictions.push({
          entity: entityName,
          field,
          values: Array.from(valueMap.entries()).map(([serialized, notes]) => ({
            value: JSON.parse(serialized),
            notes,
          })),
        });
      }
    }
  }

  return contradictions;
}


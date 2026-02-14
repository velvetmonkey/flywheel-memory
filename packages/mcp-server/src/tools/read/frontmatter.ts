/**
 * Frontmatter analysis primitives - metadata intelligence
 *
 * Answer: "What metadata exists in the vault?"
 */

import type { VaultIndex } from '../../core/read/types.js';

/** Information about a frontmatter field */
export interface FieldInfo {
  name: string;
  types: string[];          // JS types encountered
  count: number;            // How many notes have this field
  examples: unknown[];      // Sample values (up to 5)
  notes_sample: string[];   // Sample note paths (up to 5)
}

/** Value distribution for a field */
export interface FieldValueInfo {
  value: unknown;
  count: number;
  notes: string[];          // All notes with this value
}

/**
 * Get type of a value (more detailed than typeof)
 */
function getValueType(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return 'array';
  if (value instanceof Date) return 'date';
  return typeof value;
}

/**
 * Get schema of all frontmatter fields across vault
 */
export function getFrontmatterSchema(
  index: VaultIndex
): {
  total_notes: number;
  notes_with_frontmatter: number;
  field_count: number;
  fields: FieldInfo[];
} {
  const fieldMap = new Map<string, {
    types: Set<string>;
    count: number;
    examples: unknown[];
    notes: string[];
  }>();

  let notesWithFrontmatter = 0;

  for (const note of index.notes.values()) {
    const fm = note.frontmatter;
    if (!fm || Object.keys(fm).length === 0) continue;

    notesWithFrontmatter++;

    for (const [key, value] of Object.entries(fm)) {
      if (!fieldMap.has(key)) {
        fieldMap.set(key, {
          types: new Set(),
          count: 0,
          examples: [],
          notes: [],
        });
      }

      const info = fieldMap.get(key)!;
      info.count++;
      info.types.add(getValueType(value));

      if (info.examples.length < 5) {
        // Add unique examples
        const valueStr = JSON.stringify(value);
        const existingStrs = info.examples.map(e => JSON.stringify(e));
        if (!existingStrs.includes(valueStr)) {
          info.examples.push(value);
        }
      }

      if (info.notes.length < 5) {
        info.notes.push(note.path);
      }
    }
  }

  // Convert to output format
  const fields: FieldInfo[] = Array.from(fieldMap.entries())
    .map(([name, info]) => ({
      name,
      types: Array.from(info.types),
      count: info.count,
      examples: info.examples,
      notes_sample: info.notes,
    }))
    .sort((a, b) => b.count - a.count);  // Most common first

  return {
    total_notes: index.notes.size,
    notes_with_frontmatter: notesWithFrontmatter,
    field_count: fields.length,
    fields,
  };
}

/**
 * Get all values for a specific frontmatter field
 */
export function getFieldValues(
  index: VaultIndex,
  fieldName: string
): {
  field: string;
  total_notes_with_field: number;
  unique_values: number;
  values: FieldValueInfo[];
} {
  const valueMap = new Map<string, {
    value: unknown;
    count: number;
    notes: string[];
  }>();

  let totalWithField = 0;

  for (const note of index.notes.values()) {
    const value = note.frontmatter[fieldName];
    if (value === undefined) continue;

    totalWithField++;

    // Handle arrays - count each element
    const values = Array.isArray(value) ? value : [value];

    for (const v of values) {
      const key = JSON.stringify(v);

      if (!valueMap.has(key)) {
        valueMap.set(key, {
          value: v,
          count: 0,
          notes: [],
        });
      }

      const info = valueMap.get(key)!;
      info.count++;
      info.notes.push(note.path);
    }
  }

  // Convert to output
  const valuesList: FieldValueInfo[] = Array.from(valueMap.values())
    .sort((a, b) => b.count - a.count);

  return {
    field: fieldName,
    total_notes_with_field: totalWithField,
    unique_values: valuesList.length,
    values: valuesList,
  };
}

/**
 * Find frontmatter inconsistencies - same field with different types
 */
export function findFrontmatterInconsistencies(
  index: VaultIndex
): Array<{
  field: string;
  types_found: string[];
  examples: Array<{ type: string; value: unknown; note: string }>;
}> {
  const schema = getFrontmatterSchema(index);

  const inconsistencies: Array<{
    field: string;
    types_found: string[];
    examples: Array<{ type: string; value: unknown; note: string }>;
  }> = [];

  for (const field of schema.fields) {
    // Skip expected multi-type fields
    if (field.types.length > 1) {
      // Get examples of each type
      const examples: Array<{ type: string; value: unknown; note: string }> = [];

      for (const note of index.notes.values()) {
        const value = note.frontmatter[field.name];
        if (value === undefined) continue;

        const type = getValueType(value);

        // Check if we already have an example of this type
        if (!examples.some(e => e.type === type)) {
          examples.push({
            type,
            value,
            note: note.path,
          });
        }

        if (examples.length >= field.types.length) break;
      }

      inconsistencies.push({
        field: field.name,
        types_found: field.types,
        examples,
      });
    }
  }

  return inconsistencies;
}

/**
 * Validate notes against an expected schema
 */
export function validateFrontmatter(
  index: VaultIndex,
  schema: Record<string, {
    required?: boolean;
    type?: string | string[];
    values?: unknown[];  // Allowed values
  }>,
  folder?: string
): Array<{
  path: string;
  issues: Array<{
    field: string;
    issue: 'missing' | 'wrong_type' | 'invalid_value';
    expected: string;
    actual?: string;
  }>;
}> {
  const results: Array<{
    path: string;
    issues: Array<{
      field: string;
      issue: 'missing' | 'wrong_type' | 'invalid_value';
      expected: string;
      actual?: string;
    }>;
  }> = [];

  for (const note of index.notes.values()) {
    if (folder && !note.path.startsWith(folder)) continue;

    const issues: Array<{
      field: string;
      issue: 'missing' | 'wrong_type' | 'invalid_value';
      expected: string;
      actual?: string;
    }> = [];

    for (const [fieldName, fieldSchema] of Object.entries(schema)) {
      const value = note.frontmatter[fieldName];

      // Check required
      if (fieldSchema.required && value === undefined) {
        issues.push({
          field: fieldName,
          issue: 'missing',
          expected: 'value required',
        });
        continue;
      }

      if (value === undefined) continue;

      // Check type
      if (fieldSchema.type) {
        const actualType = getValueType(value);
        const allowedTypes = Array.isArray(fieldSchema.type)
          ? fieldSchema.type
          : [fieldSchema.type];

        if (!allowedTypes.includes(actualType)) {
          issues.push({
            field: fieldName,
            issue: 'wrong_type',
            expected: allowedTypes.join(' | '),
            actual: actualType,
          });
        }
      }

      // Check allowed values
      if (fieldSchema.values) {
        const valueStr = JSON.stringify(value);
        const allowedStrs = fieldSchema.values.map(v => JSON.stringify(v));

        if (!allowedStrs.includes(valueStr)) {
          issues.push({
            field: fieldName,
            issue: 'invalid_value',
            expected: fieldSchema.values.map(v => String(v)).join(' | '),
            actual: String(value),
          });
        }
      }
    }

    if (issues.length > 0) {
      results.push({
        path: note.path,
        issues,
      });
    }
  }

  return results;
}

/**
 * Find notes missing expected frontmatter based on folder conventions
 */
export function findMissingFrontmatter(
  index: VaultIndex,
  folderSchemas: Record<string, string[]>  // folder -> required fields
): Array<{
  path: string;
  folder: string;
  missing_fields: string[];
}> {
  const results: Array<{
    path: string;
    folder: string;
    missing_fields: string[];
  }> = [];

  for (const note of index.notes.values()) {
    for (const [folder, requiredFields] of Object.entries(folderSchemas)) {
      if (!note.path.startsWith(folder)) continue;

      const missing = requiredFields.filter(
        field => note.frontmatter[field] === undefined
      );

      if (missing.length > 0) {
        results.push({
          path: note.path,
          folder,
          missing_fields: missing,
        });
      }
    }
  }

  return results;
}

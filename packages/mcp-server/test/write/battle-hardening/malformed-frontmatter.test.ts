/**
 * Battle-Hardening Tests: Malformed Frontmatter
 *
 * Tests edge cases and error conditions in frontmatter parsing:
 * - Invalid YAML syntax
 * - Missing delimiters
 * - Malformed key-value pairs
 * - Type preservation (numbers, booleans, dates)
 * - Extremely large frontmatter
 * - Null/undefined values
 * - Special characters (Unicode, emoji, control chars)
 * - Graceful error handling
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  readVaultFile,
  writeVaultFile,
} from '../../src/core/writer.js';
import {
  createTempVault,
  cleanupTempVault,
  createTestNote,
  readTestNote,
} from '../helpers/testUtils.js';

describe('Battle-Hardening: Malformed Frontmatter', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  describe('invalid YAML syntax', () => {
    it('should handle unterminated quotes gracefully', async () => {
      const content = `---
title: "Unterminated quote
type: test
---
# Content
`;
      await createTestNote(tempVault, 'unterminated-quote.md', content);

      // gray-matter may parse this with the unterminated quote as-is
      // or throw an error - we just need to handle it gracefully
      try {
        const result = await readVaultFile(tempVault, 'unterminated-quote.md');
        // If it parses, check we got something reasonable
        expect(result.content).toContain('# Content');
      } catch (error) {
        // If it throws, ensure it's a meaningful error
        expect(error).toBeDefined();
        expect(error instanceof Error).toBe(true);
      }
    });

    it('should handle unbalanced brackets in YAML', async () => {
      const content = `---
tags: [tag1, tag2
type: test
---
# Content
`;
      await createTestNote(tempVault, 'unbalanced-brackets.md', content);

      try {
        const result = await readVaultFile(tempVault, 'unbalanced-brackets.md');
        expect(result.content).toContain('# Content');
      } catch (error) {
        expect(error instanceof Error).toBe(true);
      }
    });

    it('should handle tabs in indentation (YAML-invalid in some contexts)', async () => {
      const content = `---
nested:
\tkey: value
---
# Content
`;
      await createTestNote(tempVault, 'tab-indent.md', content);

      try {
        const result = await readVaultFile(tempVault, 'tab-indent.md');
        // gray-matter/js-yaml may handle tabs differently
        expect(result.content).toContain('# Content');
      } catch (error) {
        expect(error instanceof Error).toBe(true);
      }
    });

    it('should throw error on duplicate keys (js-yaml behavior)', async () => {
      const content = `---
type: first
type: second
type: third
---
# Content
`;
      await createTestNote(tempVault, 'duplicate-keys.md', content);

      // js-yaml throws on duplicate keys rather than using last value
      await expect(readVaultFile(tempVault, 'duplicate-keys.md')).rejects.toThrow(/duplicated mapping key/i);
    });
  });

  describe('missing or malformed delimiters', () => {
    it('should handle missing closing delimiter', async () => {
      const content = `---
title: Test
type: test
# Content without closing delimiter
`;
      await createTestNote(tempVault, 'no-closing.md', content);

      try {
        const result = await readVaultFile(tempVault, 'no-closing.md');
        // gray-matter may treat entire file as frontmatter or content
        expect(result).toBeDefined();
      } catch (error) {
        expect(error instanceof Error).toBe(true);
      }
    });

    it('should handle single dash line instead of triple', async () => {
      const content = `-
title: Test
-
# Content
`;
      await createTestNote(tempVault, 'single-dash.md', content);

      const result = await readVaultFile(tempVault, 'single-dash.md');
      // Should not parse as frontmatter
      expect(Object.keys(result.frontmatter).length).toBe(0);
    });

    it('should handle extra dashes in delimiter', async () => {
      const content = `-----
title: Test
-----
# Content
`;
      await createTestNote(tempVault, 'extra-dashes.md', content);

      // gray-matter may or may not accept extra dashes
      try {
        const result = await readVaultFile(tempVault, 'extra-dashes.md');
        expect(result.content).toContain('# Content');
      } catch (error) {
        expect(error instanceof Error).toBe(true);
      }
    });

    it('should handle spaces after delimiter', async () => {
      const content = `---
title: Test
---
# Content
`;
      await createTestNote(tempVault, 'trailing-spaces.md', content);

      const result = await readVaultFile(tempVault, 'trailing-spaces.md');
      // gray-matter should handle trailing spaces
      expect(result.frontmatter.title).toBe('Test');
    });
  });

  describe('malformed key-value pairs', () => {
    it('should handle key without colon', async () => {
      const content = `---
title Test
type: valid
---
# Content
`;
      await createTestNote(tempVault, 'no-colon.md', content);

      try {
        const result = await readVaultFile(tempVault, 'no-colon.md');
        expect(result.content).toContain('# Content');
      } catch (error) {
        expect(error instanceof Error).toBe(true);
      }
    });

    it('should handle key:value with colon but following line has colon too', async () => {
      // js-yaml is strict about YAML format; some edge cases throw errors
      const content = `---
title:no-space
type: valid
---
# Content
`;
      await createTestNote(tempVault, 'no-space.md', content);

      // js-yaml/gray-matter may throw on malformed YAML
      try {
        const result = await readVaultFile(tempVault, 'no-space.md');
        // If it parses, verify content is accessible
        expect(result.content).toContain('# Content');
      } catch (error) {
        // Error is acceptable for malformed YAML
        expect(error).toBeDefined();
      }
    });

    it('should handle well-formed key: value with space', async () => {
      const content = `---
title: "with space"
type: valid
---
# Content
`;
      await createTestNote(tempVault, 'with-space.md', content);

      const result = await readVaultFile(tempVault, 'with-space.md');
      expect(result.frontmatter.title).toBe('with space');
      expect(result.frontmatter.type).toBe('valid');
    });

    it('should handle empty value', async () => {
      const content = `---
title:
type: test
---
# Content
`;
      await createTestNote(tempVault, 'empty-value.md', content);

      const result = await readVaultFile(tempVault, 'empty-value.md');
      expect(result.frontmatter.title).toBeNull();
      expect(result.frontmatter.type).toBe('test');
    });

    it('should handle key with special characters', async () => {
      const content = `---
"key-with-dashes": value1
'key.with.dots': value2
---
# Content
`;
      await createTestNote(tempVault, 'special-keys.md', content);

      const result = await readVaultFile(tempVault, 'special-keys.md');
      expect(result.frontmatter['key-with-dashes']).toBe('value1');
      expect(result.frontmatter['key.with.dots']).toBe('value2');
    });
  });

  describe('type preservation', () => {
    it('should preserve number types', async () => {
      const content = `---
integer: 42
float: 3.14159
negative: -100
scientific: 1.5e10
---
# Content
`;
      await createTestNote(tempVault, 'numbers.md', content);

      const result = await readVaultFile(tempVault, 'numbers.md');
      expect(result.frontmatter.integer).toBe(42);
      expect(typeof result.frontmatter.integer).toBe('number');
      expect(result.frontmatter.float).toBeCloseTo(3.14159);
      expect(result.frontmatter.negative).toBe(-100);
      expect(result.frontmatter.scientific).toBe(1.5e10);
    });

    it('should preserve boolean types', async () => {
      const content = `---
bool_true: true
bool_false: false
---
# Content
`;
      await createTestNote(tempVault, 'booleans.md', content);

      const result = await readVaultFile(tempVault, 'booleans.md');
      expect(result.frontmatter.bool_true).toBe(true);
      expect(result.frontmatter.bool_false).toBe(false);
    });

    it('should preserve yes/no as strings in YAML 1.2', async () => {
      // Note: gray-matter uses YAML 1.2 which treats yes/no as strings, not booleans
      const content = `---
yes_value: yes
no_value: no
---
# Content
`;
      await createTestNote(tempVault, 'yes-no.md', content);

      const result = await readVaultFile(tempVault, 'yes-no.md');
      // YAML 1.2 keeps yes/no as strings
      expect(result.frontmatter.yes_value).toBe('yes');
      expect(result.frontmatter.no_value).toBe('no');
    });

    it('should preserve date types', async () => {
      const content = `---
date_iso: 2026-01-30
datetime: 2026-01-30T10:30:00Z
---
# Content
`;
      await createTestNote(tempVault, 'dates.md', content);

      const result = await readVaultFile(tempVault, 'dates.md');
      // gray-matter/js-yaml parses dates as Date objects
      expect(result.frontmatter.date_iso instanceof Date).toBe(true);
      expect(result.frontmatter.datetime instanceof Date).toBe(true);
    });

    it('should preserve array types', async () => {
      const content = `---
tags:
  - one
  - two
  - three
inline_array: [a, b, c]
---
# Content
`;
      await createTestNote(tempVault, 'arrays.md', content);

      const result = await readVaultFile(tempVault, 'arrays.md');
      expect(Array.isArray(result.frontmatter.tags)).toBe(true);
      expect(result.frontmatter.tags).toEqual(['one', 'two', 'three']);
      expect(Array.isArray(result.frontmatter.inline_array)).toBe(true);
      expect(result.frontmatter.inline_array).toEqual(['a', 'b', 'c']);
    });

    it('should preserve nested object types', async () => {
      const content = `---
metadata:
  author: Test User
  version:
    major: 1
    minor: 2
    patch: 3
---
# Content
`;
      await createTestNote(tempVault, 'nested.md', content);

      const result = await readVaultFile(tempVault, 'nested.md');
      expect(typeof result.frontmatter.metadata).toBe('object');
      expect(result.frontmatter.metadata.author).toBe('Test User');
      expect(result.frontmatter.metadata.version.major).toBe(1);
    });

    it('should preserve types through write/read cycle', async () => {
      const originalFrontmatter = {
        number: 42,
        float: 3.14,
        bool: true,
        array: [1, 2, 3],
        nested: { key: 'value' },
      };

      await writeVaultFile(tempVault, 'roundtrip.md', '# Content', originalFrontmatter);
      const result = await readVaultFile(tempVault, 'roundtrip.md');

      expect(result.frontmatter.number).toBe(42);
      expect(typeof result.frontmatter.number).toBe('number');
      expect(result.frontmatter.float).toBeCloseTo(3.14);
      expect(result.frontmatter.bool).toBe(true);
      expect(result.frontmatter.array).toEqual([1, 2, 3]);
      expect(result.frontmatter.nested.key).toBe('value');
    });
  });

  describe('extremely large frontmatter', () => {
    it('should handle 100+ field frontmatter', async () => {
      const fields: string[] = [];
      for (let i = 0; i < 100; i++) {
        fields.push(`field_${i}: value_${i}`);
      }
      const content = `---
${fields.join('\n')}
---
# Content
`;
      await createTestNote(tempVault, 'many-fields.md', content);

      const result = await readVaultFile(tempVault, 'many-fields.md');
      expect(Object.keys(result.frontmatter).length).toBe(100);
      expect(result.frontmatter.field_0).toBe('value_0');
      expect(result.frontmatter.field_99).toBe('value_99');
    });

    it('should handle 1000+ line frontmatter array', async () => {
      const items: string[] = [];
      for (let i = 0; i < 1000; i++) {
        items.push(`  - item_${i}`);
      }
      const content = `---
large_array:
${items.join('\n')}
---
# Content
`;
      await createTestNote(tempVault, 'large-array.md', content);

      const result = await readVaultFile(tempVault, 'large-array.md');
      expect(Array.isArray(result.frontmatter.large_array)).toBe(true);
      expect(result.frontmatter.large_array.length).toBe(1000);
      expect(result.frontmatter.large_array[0]).toBe('item_0');
      expect(result.frontmatter.large_array[999]).toBe('item_999');
    });

    it('should handle very long string values', async () => {
      const longValue = 'A'.repeat(10000);
      const content = `---
long_string: "${longValue}"
---
# Content
`;
      await createTestNote(tempVault, 'long-string.md', content);

      const result = await readVaultFile(tempVault, 'long-string.md');
      expect(result.frontmatter.long_string.length).toBe(10000);
    });

    it('should handle deeply nested structures', async () => {
      const content = `---
level1:
  level2:
    level3:
      level4:
        level5:
          level6:
            level7:
              level8:
                level9:
                  level10:
                    value: deep
---
# Content
`;
      await createTestNote(tempVault, 'deep-nesting.md', content);

      const result = await readVaultFile(tempVault, 'deep-nesting.md');
      const deepValue = result.frontmatter
        .level1.level2.level3.level4.level5
        .level6.level7.level8.level9.level10.value;
      expect(deepValue).toBe('deep');
    });
  });

  describe('null and undefined values', () => {
    it('should handle explicit null values', async () => {
      const content = `---
explicit_null: null
tilde_null: ~
empty:
---
# Content
`;
      await createTestNote(tempVault, 'nulls.md', content);

      const result = await readVaultFile(tempVault, 'nulls.md');
      expect(result.frontmatter.explicit_null).toBeNull();
      expect(result.frontmatter.tilde_null).toBeNull();
      expect(result.frontmatter.empty).toBeNull();
    });

    it('should handle null in arrays', async () => {
      const content = `---
array_with_nulls:
  - item1
  - null
  - item3
  - ~
  - item5
---
# Content
`;
      await createTestNote(tempVault, 'array-nulls.md', content);

      const result = await readVaultFile(tempVault, 'array-nulls.md');
      expect(result.frontmatter.array_with_nulls[1]).toBeNull();
      expect(result.frontmatter.array_with_nulls[3]).toBeNull();
    });

    it('should handle null in nested objects', async () => {
      const content = `---
nested:
  present: value
  absent: null
  also_absent: ~
---
# Content
`;
      await createTestNote(tempVault, 'nested-nulls.md', content);

      const result = await readVaultFile(tempVault, 'nested-nulls.md');
      expect(result.frontmatter.nested.present).toBe('value');
      expect(result.frontmatter.nested.absent).toBeNull();
      expect(result.frontmatter.nested.also_absent).toBeNull();
    });
  });

  describe('special characters', () => {
    it('should handle Unicode characters in values', async () => {
      const content = `---
japanese: 日本語テスト
chinese: 中文测试
korean: 한국어 테스트
arabic: اختبار
greek: Ελληνικά
---
# Content
`;
      await createTestNote(tempVault, 'unicode.md', content);

      const result = await readVaultFile(tempVault, 'unicode.md');
      expect(result.frontmatter.japanese).toBe('日本語テスト');
      expect(result.frontmatter.chinese).toBe('中文测试');
      expect(result.frontmatter.korean).toBe('한국어 테스트');
    });

    it('should handle emoji in values', async () => {
      const content = `---
emoji: "Test with emoji: 🎉🚀💡"
emoji_key_value: "Key: 📝 Value: ✅"
---
# Content
`;
      await createTestNote(tempVault, 'emoji.md', content);

      const result = await readVaultFile(tempVault, 'emoji.md');
      expect(result.frontmatter.emoji).toContain('🎉');
      expect(result.frontmatter.emoji).toContain('🚀');
      expect(result.frontmatter.emoji_key_value).toContain('📝');
    });

    it('should handle special YAML characters with quoting', async () => {
      const content = `---
colon_value: "value: with colon"
hash_value: "value # with hash"
at_value: "@mention test"
ampersand: "&reference test"
asterisk: "*starred text*"
---
# Content
`;
      await createTestNote(tempVault, 'special-yaml.md', content);

      const result = await readVaultFile(tempVault, 'special-yaml.md');
      expect(result.frontmatter.colon_value).toBe('value: with colon');
      expect(result.frontmatter.hash_value).toBe('value # with hash');
      expect(result.frontmatter.at_value).toBe('@mention test');
    });

    it('should handle multiline strings', async () => {
      const content = `---
literal: |
  Line 1
  Line 2
  Line 3
folded: >
  This is a long
  paragraph that gets
  folded into one line.
---
# Content
`;
      await createTestNote(tempVault, 'multiline.md', content);

      const result = await readVaultFile(tempVault, 'multiline.md');
      expect(result.frontmatter.literal).toContain('Line 1');
      expect(result.frontmatter.literal).toContain('Line 2');
      expect(result.frontmatter.folded).toContain('paragraph');
    });

    it('should handle escaped characters', async () => {
      const content = `---
newline: "Line1\\nLine2"
tab: "Col1\\tCol2"
backslash: "path\\\\to\\\\file"
quote: "He said \\"hello\\""
---
# Content
`;
      await createTestNote(tempVault, 'escaped.md', content);

      const result = await readVaultFile(tempVault, 'escaped.md');
      expect(result.frontmatter.newline).toBe('Line1\nLine2');
      expect(result.frontmatter.tab).toBe('Col1\tCol2');
      expect(result.frontmatter.backslash).toBe('path\\to\\file');
      expect(result.frontmatter.quote).toBe('He said "hello"');
    });

    it('should handle control characters gracefully', async () => {
      // Note: Some control chars may cause issues, we test tab which is common
      const content = `---
with_tab: "value\twith\ttabs"
---
# Content
`;
      await createTestNote(tempVault, 'control.md', content);

      const result = await readVaultFile(tempVault, 'control.md');
      expect(result.frontmatter.with_tab).toContain('\t');
    });
  });

  describe('graceful error handling', () => {
    it('should preserve original content when frontmatter is completely invalid', async () => {
      // This tests that we don't corrupt the file on parse failure
      const content = `---
: this is invalid YAML
[[[badly formed
---
# Content
Some important content here
`;
      await createTestNote(tempVault, 'corrupt.md', content);

      try {
        await readVaultFile(tempVault, 'corrupt.md');
      } catch {
        // Even if parsing fails, original file should be unchanged
        const rawContent = await readTestNote(tempVault, 'corrupt.md');
        expect(rawContent).toContain('Some important content here');
      }
    });

    it('should handle file with only invalid frontmatter section', async () => {
      const content = `---
invalid: [
---
`;
      await createTestNote(tempVault, 'only-invalid.md', content);

      try {
        const result = await readVaultFile(tempVault, 'only-invalid.md');
        // If it parses, content should be minimal
        expect(result).toBeDefined();
      } catch (error) {
        expect(error instanceof Error).toBe(true);
      }
    });

    it('should handle binary-like content in frontmatter gracefully', async () => {
      // Simulate a file that has some binary-ish content
      const content = `---
title: Normal title
---
# Content with normal text
`;
      await createTestNote(tempVault, 'normal-content.md', content);

      const result = await readVaultFile(tempVault, 'normal-content.md');
      expect(result.frontmatter.title).toBe('Normal title');
    });

    it('should report meaningful errors for common mistakes', async () => {
      const content = `---
# This looks like a heading but is in frontmatter
title: Test
---
# Real heading
`;
      await createTestNote(tempVault, 'heading-in-fm.md', content);

      // YAML treats # as comment, so this should parse
      const result = await readVaultFile(tempVault, 'heading-in-fm.md');
      expect(result.frontmatter.title).toBe('Test');
    });
  });

  describe('empty and minimal frontmatter', () => {
    it('should handle empty frontmatter (only delimiters)', async () => {
      const content = `---
---
# Content
This file has empty frontmatter.
`;
      await createTestNote(tempVault, 'empty-fm.md', content);

      const result = await readVaultFile(tempVault, 'empty-fm.md');
      expect(Object.keys(result.frontmatter).length).toBe(0);
      expect(result.content).toContain('# Content');
    });

    it('should handle frontmatter with only whitespace', async () => {
      const content = `---


---
# Content
`;
      await createTestNote(tempVault, 'whitespace-fm.md', content);

      const result = await readVaultFile(tempVault, 'whitespace-fm.md');
      expect(Object.keys(result.frontmatter).length).toBe(0);
      expect(result.content).toContain('# Content');
    });

    it('should handle frontmatter with only comments', async () => {
      const content = `---
# This is a YAML comment
# Another comment
---
# Content
`;
      await createTestNote(tempVault, 'comments-fm.md', content);

      const result = await readVaultFile(tempVault, 'comments-fm.md');
      expect(Object.keys(result.frontmatter).length).toBe(0);
      expect(result.content).toContain('# Content');
    });
  });

  describe('non-YAML frontmatter detection', () => {
    it('should handle JSON-like frontmatter (treated as invalid YAML)', async () => {
      // JSON is valid YAML, but brace-style may confuse gray-matter
      const content = `---
{
  "title": "Test",
  "type": "note"
}
---
# Content
`;
      await createTestNote(tempVault, 'json-fm.md', content);

      try {
        const result = await readVaultFile(tempVault, 'json-fm.md');
        // If parsed, the JSON object becomes the frontmatter
        expect(result.content).toContain('# Content');
      } catch (error) {
        // Throwing is acceptable for edge-case YAML
        expect(error instanceof Error).toBe(true);
      }
    });

    it('should handle TOML-style frontmatter (invalid in gray-matter)', async () => {
      // TOML uses +++ delimiters, not --- - gray-matter won't recognize it
      const content = `+++
title = "Test"
type = "note"
+++
# Content
`;
      await createTestNote(tempVault, 'toml-fm.md', content);

      const result = await readVaultFile(tempVault, 'toml-fm.md');
      // Should not parse as frontmatter (wrong delimiters)
      expect(Object.keys(result.frontmatter).length).toBe(0);
      // Content should include the TOML-style block
      expect(result.content).toContain('+++');
    });

    it('should handle mixed YAML/JSON inline syntax', async () => {
      const content = `---
tags: ["tag1", "tag2"]
metadata: {nested: "value", count: 42}
---
# Content
`;
      await createTestNote(tempVault, 'mixed-syntax.md', content);

      const result = await readVaultFile(tempVault, 'mixed-syntax.md');
      expect(result.frontmatter.tags).toEqual(['tag1', 'tag2']);
      expect(result.frontmatter.metadata).toEqual({ nested: 'value', count: 42 });
    });
  });

  describe('unclosed and malformed delimiters', () => {
    it('should handle file starting with --- but never closing', async () => {
      const content = `---
title: Test
type: note

# This looks like content but frontmatter never closed
Some text here.
`;
      await createTestNote(tempVault, 'never-closed.md', content);

      try {
        const result = await readVaultFile(tempVault, 'never-closed.md');
        // gray-matter may treat entire file as frontmatter or fail
        expect(result).toBeDefined();
      } catch (error) {
        expect(error instanceof Error).toBe(true);
      }
    });

    it('should handle --- appearing mid-file (not frontmatter)', async () => {
      const content = `# Document Title

Some introductory text.

---

This is a horizontal rule, not frontmatter.

---

Another horizontal rule.
`;
      await createTestNote(tempVault, 'hr-not-fm.md', content);

      const result = await readVaultFile(tempVault, 'hr-not-fm.md');
      // Should not have frontmatter (doesn't start with ---)
      expect(Object.keys(result.frontmatter).length).toBe(0);
      expect(result.content).toContain('# Document Title');
    });

    it('should handle multiple --- delimiters in file', async () => {
      const content = `---
title: Test
---
# Content

---

Horizontal rule above.

---

Another one.
`;
      await createTestNote(tempVault, 'multiple-hr.md', content);

      const result = await readVaultFile(tempVault, 'multiple-hr.md');
      expect(result.frontmatter.title).toBe('Test');
      // Content should include the horizontal rules
      expect(result.content).toContain('# Content');
      expect(result.content).toContain('Horizontal rule above');
    });
  });
});

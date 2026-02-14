/**
 * Tests for input validation and output guardrails
 */

import { describe, it, expect } from 'vitest';
import {
  validateInput,
  normalizeInput,
  validateOutput,
  runValidationPipeline,
} from '../../src/core/validator.js';

describe('validateInput', () => {
  describe('double timestamp detection', () => {
    it('should warn when content has timestamp and format is timestamp-bullet', () => {
      const result = validateInput('**12:30** Already has timestamp', 'timestamp-bullet');
      expect(result.isValid).toBe(false);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].type).toBe('double-timestamp');
    });

    it('should not warn when format is not timestamp-bullet', () => {
      const result = validateInput('**12:30** Already has timestamp', 'bullet');
      expect(result.warnings.find(w => w.type === 'double-timestamp')).toBeUndefined();
    });

    it('should not warn when content has no timestamp', () => {
      const result = validateInput('Regular content', 'timestamp-bullet');
      expect(result.warnings.find(w => w.type === 'double-timestamp')).toBeUndefined();
    });
  });

  describe('non-markdown bullet detection', () => {
    it('should detect bullet character (•)', () => {
      const result = validateInput('• Item with bullet', 'plain');
      expect(result.warnings.find(w => w.type === 'non-markdown-bullets')).toBeDefined();
    });

    it('should detect hollow bullet character (◦)', () => {
      const result = validateInput('◦ Item with hollow bullet', 'plain');
      expect(result.warnings.find(w => w.type === 'non-markdown-bullets')).toBeDefined();
    });

    it('should detect triangular bullet (‣)', () => {
      const result = validateInput('‣ Item with triangle', 'plain');
      expect(result.warnings.find(w => w.type === 'non-markdown-bullets')).toBeDefined();
    });

    it('should not warn for markdown bullets', () => {
      const result = validateInput('- Regular bullet', 'plain');
      expect(result.warnings.find(w => w.type === 'non-markdown-bullets')).toBeUndefined();
    });
  });

  describe('embedded heading detection', () => {
    it('should detect headings in content', () => {
      const result = validateInput('Some content\n## Heading inside\nMore content', 'bullet');
      expect(result.warnings.find(w => w.type === 'embedded-heading')).toBeDefined();
    });

    it('should detect all heading levels', () => {
      const result1 = validateInput('# H1 heading', 'plain');
      const result2 = validateInput('### H3 heading', 'plain');
      const result3 = validateInput('###### H6 heading', 'plain');
      expect(result1.warnings.find(w => w.type === 'embedded-heading')).toBeDefined();
      expect(result2.warnings.find(w => w.type === 'embedded-heading')).toBeDefined();
      expect(result3.warnings.find(w => w.type === 'embedded-heading')).toBeDefined();
    });

    it('should not warn for text with # not at line start', () => {
      const result = validateInput('Issue #123 is important', 'plain');
      expect(result.warnings.find(w => w.type === 'embedded-heading')).toBeUndefined();
    });
  });

  describe('orphaned fence detection', () => {
    it('should detect unclosed code blocks', () => {
      const result = validateInput('```\ncode here\nno closing fence', 'plain');
      expect(result.warnings.find(w => w.type === 'orphaned-fence')).toBeDefined();
    });

    it('should not warn for properly closed code blocks', () => {
      const result = validateInput('```\ncode here\n```', 'plain');
      expect(result.warnings.find(w => w.type === 'orphaned-fence')).toBeUndefined();
    });

    it('should handle multiple code blocks', () => {
      const valid = '```\nblock1\n```\n\n```\nblock2\n```';
      const invalid = '```\nblock1\n```\n\n```\nunclosed';
      expect(validateInput(valid, 'plain').warnings.find(w => w.type === 'orphaned-fence')).toBeUndefined();
      expect(validateInput(invalid, 'plain').warnings.find(w => w.type === 'orphaned-fence')).toBeDefined();
    });
  });
});

describe('normalizeInput', () => {
  describe('duplicate timestamp removal', () => {
    it('should remove duplicate timestamp when format is timestamp-bullet', () => {
      const result = normalizeInput('**12:30** Content here', 'timestamp-bullet');
      expect(result.content).toBe('Content here');
      expect(result.normalized).toBe(true);
      expect(result.changes).toContain('Removed duplicate timestamp prefix');
    });

    it('should not modify when format is not timestamp-bullet', () => {
      const result = normalizeInput('**12:30** Content here', 'bullet');
      expect(result.content).toBe('**12:30** Content here');
      expect(result.normalized).toBe(false);
    });
  });

  describe('non-markdown bullet replacement', () => {
    it('should replace • with -', () => {
      const result = normalizeInput('• First item\n• Second item', 'plain');
      expect(result.content).toBe('- First item\n- Second item');
      expect(result.normalized).toBe(true);
      expect(result.changes).toContain('Replaced non-markdown bullets with "-"');
    });

    it('should preserve indentation when replacing bullets', () => {
      const result = normalizeInput('  • Indented item', 'plain');
      expect(result.content).toBe('  - Indented item');
    });

    it('should not modify markdown bullets', () => {
      const result = normalizeInput('- Already markdown', 'plain');
      expect(result.content).toBe('- Already markdown');
      expect(result.normalized).toBe(false);
    });
  });

  describe('excessive whitespace trimming', () => {
    it('should reduce multiple blank lines to double', () => {
      const result = normalizeInput('Line 1\n\n\n\nLine 2', 'plain');
      expect(result.content).toBe('Line 1\n\nLine 2');
      expect(result.changes).toContain('Trimmed excessive blank lines');
    });

    it('should preserve double blank lines', () => {
      const result = normalizeInput('Line 1\n\nLine 2', 'plain');
      expect(result.content).toBe('Line 1\n\nLine 2');
    });
  });
});

describe('validateOutput', () => {
  describe('broken table detection', () => {
    it('should detect tables with inconsistent pipe counts', () => {
      const content = '| A | B | C |\n| - | - |\n| 1 | 2 |';
      const result = validateOutput(content);
      expect(result.issues.find(i => i.type === 'broken-table')).toBeDefined();
    });

    it('should pass tables with consistent pipes', () => {
      const content = '| A | B |\n| - | - |\n| 1 | 2 |';
      const result = validateOutput(content);
      expect(result.issues.find(i => i.type === 'broken-table')).toBeUndefined();
    });

    it('should ignore single table rows', () => {
      const content = 'Some text\n| just one row |';
      const result = validateOutput(content);
      expect(result.issues.find(i => i.type === 'broken-table')).toBeUndefined();
    });
  });

  describe('orphaned fence detection', () => {
    it('should detect unclosed code blocks', () => {
      const content = 'Text\n```\ncode\n';
      const result = validateOutput(content);
      expect(result.valid).toBe(false);
      expect(result.issues.find(i => i.type === 'orphaned-fence')).toBeDefined();
    });

    it('should pass properly closed blocks', () => {
      const content = '```\ncode\n```';
      const result = validateOutput(content);
      expect(result.issues.find(i => i.type === 'orphaned-fence')).toBeUndefined();
    });
  });

  describe('indented fence detection', () => {
    it('should warn about indented code fences', () => {
      const content = 'List item:\n  ```\n  code\n  ```';
      const result = validateOutput(content);
      const warnings = result.issues.filter(i => i.type === 'indented-fence');
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0].severity).toBe('warning');
    });

    it('should report line numbers for indented fences', () => {
      const content = 'Line 1\nLine 2\n  ```\ncode';
      const result = validateOutput(content);
      const warning = result.issues.find(i => i.type === 'indented-fence');
      expect(warning?.line).toBe(3);
    });

    it('should not warn about non-indented fences', () => {
      const content = '```\ncode\n```';
      const result = validateOutput(content);
      expect(result.issues.find(i => i.type === 'indented-fence')).toBeUndefined();
    });
  });

  describe('broken blockquote detection', () => {
    it('should warn about broken blockquote continuation', () => {
      const content = '> Quote starts\n  continuation without >';
      const result = validateOutput(content);
      const warning = result.issues.find(i => i.type === 'broken-blockquote');
      expect(warning).toBeDefined();
      expect(warning?.severity).toBe('warning');
    });

    it('should not warn about proper blockquotes', () => {
      const content = '> Line 1\n> Line 2';
      const result = validateOutput(content);
      expect(result.issues.find(i => i.type === 'broken-blockquote')).toBeUndefined();
    });

    it('should not warn about empty line after blockquote', () => {
      const content = '> Quote\n\nRegular text';
      const result = validateOutput(content);
      expect(result.issues.find(i => i.type === 'broken-blockquote')).toBeUndefined();
    });
  });
});

describe('runValidationPipeline', () => {
  describe('default options', () => {
    it('should run all validations by default', () => {
      const result = runValidationPipeline('• Content with **12:30** timestamp', 'timestamp-bullet');
      expect(result.inputWarnings.length).toBeGreaterThan(0);
      expect(result.normalizationChanges.length).toBeGreaterThan(0);
    });

    it('should normalize content by default', () => {
      const result = runValidationPipeline('• Item', 'plain');
      expect(result.content).toBe('- Item');
    });
  });

  describe('validate option', () => {
    it('should skip input validation when validate=false', () => {
      const result = runValidationPipeline('**12:30** Content', 'timestamp-bullet', {
        validate: false,
      });
      expect(result.inputWarnings).toHaveLength(0);
    });
  });

  describe('normalize option', () => {
    it('should skip normalization when normalize=false', () => {
      const result = runValidationPipeline('• Item', 'plain', {
        normalize: false,
      });
      expect(result.content).toBe('• Item');
      expect(result.normalizationChanges).toHaveLength(0);
    });
  });

  describe('guardrails option', () => {
    it('should include output issues when guardrails=warn', () => {
      const content = '```\nunclosed';
      const result = runValidationPipeline(content, 'plain', { guardrails: 'warn' });
      expect(result.outputIssues.length).toBeGreaterThan(0);
      expect(result.blocked).toBe(false);
    });

    it('should block when guardrails=strict and errors exist', () => {
      const content = '```\nunclosed';
      const result = runValidationPipeline(content, 'plain', { guardrails: 'strict' });
      expect(result.blocked).toBe(true);
      expect(result.blockReason).toBeDefined();
    });

    it('should not block for warnings in strict mode', () => {
      // Indented fence is only a warning, not an error
      const content = '  ```\ncode\n  ```';
      const result = runValidationPipeline(content, 'plain', { guardrails: 'strict' });
      expect(result.blocked).toBe(false);
    });

    it('should skip output validation when guardrails=off', () => {
      const content = '```\nunclosed';
      const result = runValidationPipeline(content, 'plain', { guardrails: 'off' });
      expect(result.outputIssues).toHaveLength(0);
      expect(result.blocked).toBe(false);
    });
  });

  describe('real-world scenarios', () => {
    it('should handle typical log entry with proper formatting', () => {
      const content = 'Completed review of the feature. Everything looks good.';
      const result = runValidationPipeline(content, 'timestamp-bullet');
      expect(result.blocked).toBe(false);
      expect(result.inputWarnings).toHaveLength(0);
    });

    it('should handle content with code block', () => {
      const content = 'Found bug in code:\n```js\nconst x = undefined;\n```';
      const result = runValidationPipeline(content, 'bullet');
      expect(result.blocked).toBe(false);
    });

    it('should handle content with table', () => {
      const content = 'Release summary:\n| Version | Date |\n| ------- | ---- |\n| 1.0.0   | Jan  |';
      const result = runValidationPipeline(content, 'bullet');
      expect(result.blocked).toBe(false);
    });

    it('should warn about embedded heading but not block', () => {
      const content = 'Notes:\n## Important\nContent here';
      const result = runValidationPipeline(content, 'bullet');
      expect(result.inputWarnings.find(w => w.type === 'embedded-heading')).toBeDefined();
      expect(result.blocked).toBe(false);
    });
  });
});

describe('validation integration', () => {
  it('should process complex content correctly', () => {
    const complexContent = `• Meeting notes from standup
**12:30** - discussed roadmap

## Key points
| Topic | Owner |
| ----- | ----- |
| Auth  | Alice |

\`\`\`
code review needed
\`\`\``;

    const result = runValidationPipeline(complexContent, 'bullet');

    // Should normalize bullets
    expect(result.content).toContain('- Meeting notes');

    // Should warn about embedded heading
    expect(result.inputWarnings.find(w => w.type === 'embedded-heading')).toBeDefined();

    // Should not block (only warnings)
    expect(result.blocked).toBe(false);
  });

  it('should handle empty content', () => {
    const result = runValidationPipeline('', 'plain');
    expect(result.blocked).toBe(false);
    expect(result.content).toBe('');
  });

  it('should handle whitespace-only content', () => {
    const result = runValidationPipeline('   \n\n   ', 'plain');
    expect(result.blocked).toBe(false);
  });
});

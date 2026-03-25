/**
 * Tests for wikilink application
 */

import { describe, it, expect } from 'vitest';
import { applyWikilinks, suggestWikilinks, detectImplicitEntities, processWikilinks, resolveAliasWikilinks } from '../src/wikilinks.js';

describe('applyWikilinks', () => {
  it('should apply wikilinks to matching entities', () => {
    const content = 'Working with Claude Code on the project';
    const entities = ['Claude Code'];
    const result = applyWikilinks(content, entities);

    expect(result.content).toBe('Working with [[Claude Code]] on the project');
    expect(result.linksAdded).toBe(1);
    expect(result.linkedEntities).toContain('Claude Code');
  });

  it('should apply multiple wikilinks', () => {
    const content = 'Using React and TypeScript for the API';
    const entities = ['React', 'TypeScript', 'API'];
    const result = applyWikilinks(content, entities);

    expect(result.content).toContain('[[React]]');
    expect(result.content).toContain('[[TypeScript]]');
    expect(result.content).toContain('[[API]]');
    expect(result.linksAdded).toBe(3);
  });

  it('should only link first occurrence by default', () => {
    const content = 'React is great. I love React. React rocks!';
    const entities = ['React'];
    const result = applyWikilinks(content, entities);

    expect(result.content).toBe('[[React]] is great. I love React. React rocks!');
    expect(result.linksAdded).toBe(1);
  });

  it('should link all occurrences when firstOccurrenceOnly is false', () => {
    const content = 'React is great. I love React.';
    const entities = ['React'];
    const result = applyWikilinks(content, entities, { firstOccurrenceOnly: false });

    expect(result.content).toBe('[[React]] is great. I love [[React]].');
    expect(result.linksAdded).toBe(2);
  });

  it('should not link inside existing wikilinks', () => {
    const content = 'See [[React Guide]] for React tips';
    const entities = ['React'];
    const result = applyWikilinks(content, entities);

    // Should only link the standalone "React", not the one in [[React Guide]]
    expect(result.content).toBe('See [[React Guide]] for [[React]] tips');
    expect(result.linksAdded).toBe(1);
  });

  it('should not link inside code blocks', () => {
    const content = 'Use React:\n```\nimport React from "react";\n```\nReact is awesome';
    const entities = ['React'];
    const result = applyWikilinks(content, entities);

    // Should not link React inside code block, only the first valid occurrence
    expect(result.content).toContain('Use [[React]]:');
    expect(result.content).toContain('```\nimport React from "react";\n```');
    // With firstOccurrenceOnly=true (default), only first valid occurrence is linked
    expect(result.linksAdded).toBe(1);
  });

  it('should link all valid occurrences outside code blocks when firstOccurrenceOnly is false', () => {
    const content = 'Use React:\n```\nimport React from "react";\n```\nReact is awesome';
    const entities = ['React'];
    const result = applyWikilinks(content, entities, { firstOccurrenceOnly: false });

    // Should link both valid occurrences but not the one in code block
    expect(result.content).toContain('Use [[React]]:');
    expect(result.content).toContain('```\nimport React from "react";\n```');
    expect(result.content).toContain('[[React]] is awesome');
    expect(result.linksAdded).toBe(2);
  });

  it('should not link inside inline code', () => {
    const content = 'Run `npm install react` to get React';
    const entities = ['React', 'react'];
    const result = applyWikilinks(content, entities);

    // Should not link inside inline code
    expect(result.content).toContain('`npm install react`');
    expect(result.content).toContain('to get [[React]]');
  });

  it('should not link in frontmatter', () => {
    const content = `---
title: React Guide
tags: [react]
---
Learn React here`;
    const entities = ['React'];
    const result = applyWikilinks(content, entities);

    // Should not link in frontmatter
    expect(result.content).toContain('title: React Guide');
    expect(result.content).toContain('Learn [[React]] here');
    expect(result.linksAdded).toBe(1);
  });

  it('should not link URLs', () => {
    const content = 'Visit https://react.dev to learn React';
    const entities = ['React'];
    const result = applyWikilinks(content, entities);

    expect(result.content).toContain('https://react.dev');
    expect(result.content).toContain('learn [[React]]');
  });

  it('should prioritize longer matches', () => {
    const content = 'Working with API Management and the API';
    const entities = ['API', 'API Management'];
    const result = applyWikilinks(content, entities);

    // Should link "API Management" first, then standalone "API"
    expect(result.content).toContain('[[API Management]]');
    expect(result.content).toContain('and the [[API]]');
  });

  it('should prefer shorter entity term when multiple entities match same text', () => {
    // When "api" appears alone, both "API" (3 chars) and "API Management" (14 chars) could match
    // via case-insensitive matching. We should prefer "API" as the more exact match.
    const content = 'the api is broken';
    const entities = ['API', 'API Management'];
    const result = applyWikilinks(content, entities);

    // Should link to "API", not "API Management" - shorter entity is more exact
    expect(result.content).toBe('the [[API]] is broken');
    expect(result.linksAdded).toBe(1);
    expect(result.linkedEntities).toContain('API');
    expect(result.linkedEntities).not.toContain('API Management');
  });

  it('should exclude common words', () => {
    const content = 'Meeting on Monday for the project';
    const entities = ['Monday', 'Project'];
    const result = applyWikilinks(content, entities);

    // Monday should be excluded
    expect(result.content).not.toContain('[[Monday]]');
    expect(result.content).toContain('[[Project]]');
  });

  it('excludes "Month End" from auto-linking', () => {
    const content = 'The config files are off-limits for Month End to edit';
    const result = applyWikilinks(content, [
      { name: 'Month End', path: 'month-end.md', aliases: [] }
    ]);
    expect(result.content).toBe(content);
    expect(result.linksAdded).toBe(0);
  });

  it('excludes "Quarterly Review" from auto-linking', () => {
    const content = 'Prepare for the Quarterly Review next week';
    const result = applyWikilinks(content, [
      { name: 'Quarterly Review', path: 'quarterly-review.md', aliases: [] }
    ]);
    expect(result.content).toBe(content);
    expect(result.linksAdded).toBe(0);
  });

  it('should handle case-insensitive matching', () => {
    const content = 'Using react for development';
    const entities = ['React'];
    const result = applyWikilinks(content, entities, { caseInsensitive: true });

    expect(result.content).toBe('Using [[React]] for development');
  });

  it('should respect word boundaries', () => {
    const content = 'The API and APIManager are different';
    const entities = ['API'];
    const result = applyWikilinks(content, entities);

    // Should only link standalone "API", not "API" within "APIManager"
    expect(result.content).toBe('The [[API]] and APIManager are different');
    expect(result.linksAdded).toBe(1);
  });

  it('should return unchanged content with no entities', () => {
    const content = 'Some text here';
    const result = applyWikilinks(content, []);

    expect(result.content).toBe(content);
    expect(result.linksAdded).toBe(0);
  });

  describe('bracket-adjacent filtering', () => {
    it('does not insert wikilinks adjacent to closing parenthesis', () => {
      const content = '("You\'ve got momentum, focus on X today")';
      const result = applyWikilinks(content, ['today']);
      expect(result.content).toBe(content);
      expect(result.linksAdded).toBe(0);
    });

    it('does not insert wikilinks adjacent to opening bracket', () => {
      const content = 'This is a [test] example';
      const result = applyWikilinks(content, ['test']);
      expect(result.content).toBe(content);
      expect(result.linksAdded).toBe(0);
    });

    it('still links entities surrounded by spaces', () => {
      const content = 'We discussed React the progress';
      const result = applyWikilinks(content, ['React']);
      expect(result.content).toBe('We discussed [[React]] the progress');
      expect(result.linksAdded).toBe(1);
    });

    it('does not insert wikilinks adjacent to curly braces', () => {
      const content = 'The value is {test} here';
      const result = applyWikilinks(content, ['test']);
      expect(result.content).toBe(content);
      expect(result.linksAdded).toBe(0);
    });
  });

  describe('alias matching', () => {
    it('should match entity via alias and use display text format', () => {
      const content = 'The PRD is ready for review';
      const entities = [
        { name: 'Product Requirements Document', path: 'Product Requirements Document.md', aliases: ['PRD'] }
      ];
      const result = applyWikilinks(content, entities);

      expect(result.content).toBe('The [[Product Requirements Document|PRD]] is ready for review');
      expect(result.linksAdded).toBe(1);
      expect(result.linkedEntities).toContain('Product Requirements Document');
    });

    it('should match entity by name without display text', () => {
      const content = 'The API is documented';
      const entities = [
        { name: 'API', path: 'API.md', aliases: ['Application Programming Interface'] }
      ];
      const result = applyWikilinks(content, entities);

      expect(result.content).toBe('The [[API]] is documented');
      expect(result.linksAdded).toBe(1);
    });

    it('should preserve case in display text when matched via alias', () => {
      const content = 'Check the prd for details';
      const entities = [
        { name: 'Product Requirements Document', path: 'Product Requirements Document.md', aliases: ['PRD'] }
      ];
      const result = applyWikilinks(content, entities, { caseInsensitive: true });

      // Should preserve the original case of the matched text
      expect(result.content).toBe('Check the [[Product Requirements Document|prd]] for details');
    });

    it('should handle multiple aliases for same entity', () => {
      const content = 'The JS framework uses JavaScript internally';
      const entities = [
        { name: 'JavaScript', path: 'JavaScript.md', aliases: ['JS', 'ECMAScript'] }
      ];
      const result = applyWikilinks(content, entities, { firstOccurrenceOnly: false });

      expect(result.content).toContain('[[JavaScript|JS]]');
      expect(result.content).toContain('[[JavaScript]]');
      expect(result.linksAdded).toBe(2);
    });

    it('should link first occurrence only across name and aliases', () => {
      const content = 'JS is fun. JavaScript is powerful.';
      const entities = [
        { name: 'JavaScript', path: 'JavaScript.md', aliases: ['JS'] }
      ];
      const result = applyWikilinks(content, entities, { firstOccurrenceOnly: true });

      // Only first match (JS) should be linked
      expect(result.content).toBe('[[JavaScript|JS]] is fun. JavaScript is powerful.');
      expect(result.linksAdded).toBe(1);
    });

    it('should prioritize longer alias matches', () => {
      const content = 'Working with API Management and the API';
      const entities = [
        { name: 'API', path: 'API.md', aliases: [] },
        { name: 'API Management Platform', path: 'API Management Platform.md', aliases: ['API Management'] }
      ];
      const result = applyWikilinks(content, entities);

      expect(result.content).toContain('[[API Management Platform|API Management]]');
      expect(result.content).toContain('the [[API]]');
    });

    it('should work with string entities mixed with object entities', () => {
      const content = 'Using React and the PRD';
      const entities = [
        'React',
        { name: 'Product Requirements Document', path: 'Product Requirements Document.md', aliases: ['PRD'] }
      ];
      const result = applyWikilinks(content, entities);

      expect(result.content).toContain('[[React]]');
      expect(result.content).toContain('[[Product Requirements Document|PRD]]');
    });

    it('should match multi-word alias in plain text', () => {
      const content = 'The Model Context Protocol enables tool use';
      const entities = [
        { name: 'MCP', path: 'MCP.md', aliases: ['Model Context Protocol'] }
      ];
      const result = applyWikilinks(content, entities);

      expect(result.content).toBe('The [[MCP|Model Context Protocol]] enables tool use');
      expect(result.linksAdded).toBe(1);
      expect(result.linkedEntities).toContain('MCP');
    });

    it('should match multi-word alias case-insensitively', () => {
      const content = 'Learned about model context protocol today';
      const entities = [
        { name: 'MCP', path: 'MCP.md', aliases: ['Model Context Protocol'] }
      ];
      const result = applyWikilinks(content, entities, { caseInsensitive: true });

      expect(result.content).toBe('Learned about [[MCP|model context protocol]] today');
      expect(result.linksAdded).toBe(1);
    });

    it('should match multi-word alias among other text with entity name', () => {
      const content = 'A test Model Context Protocol message about MCP';
      const entities = [
        { name: 'MCP', path: 'MCP.md', aliases: ['Model Context Protocol'] }
      ];
      const result = applyWikilinks(content, entities, { firstOccurrenceOnly: false });

      // Both the alias and the name should be linked
      expect(result.content).toContain('[[MCP|Model Context Protocol]]');
      expect(result.content).toContain('about [[MCP]]');
      expect(result.linksAdded).toBe(2);
    });
  });
});

describe('suggestWikilinks', () => {
  it('should suggest wikilinks without applying them', () => {
    const content = 'Working with React today';
    const entities = ['React'];
    const suggestions = suggestWikilinks(content, entities);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].entity).toBe('React');
    expect(suggestions[0].start).toBeGreaterThan(0);
    expect(suggestions[0].end).toBeGreaterThan(suggestions[0].start);
  });

  it('should include context in suggestions', () => {
    const content = 'I am working with React for this project';
    const entities = ['React'];
    const suggestions = suggestWikilinks(content, entities);

    expect(suggestions[0].context).toContain('React');
  });

  it('should skip protected zones', () => {
    const content = 'Code: `React` and React framework';
    const entities = ['React'];
    const suggestions = suggestWikilinks(content, entities);

    // Should only suggest the second React (outside inline code)
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].start).toBeGreaterThan(content.indexOf('`React`'));
  });

  describe('alias matching', () => {
    it('should suggest entity when content matches alias', () => {
      const content = 'Check the PRD for details';
      const entities = [
        { name: 'Product Requirements Document', path: 'Product Requirements Document.md', aliases: ['PRD'] }
      ];
      const suggestions = suggestWikilinks(content, entities);

      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].entity).toBe('Product Requirements Document');
    });

    it('should suggest entity when content matches name', () => {
      const content = 'The API is documented';
      const entities = [
        { name: 'API', path: 'API.md', aliases: ['Application Programming Interface'] }
      ];
      const suggestions = suggestWikilinks(content, entities);

      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].entity).toBe('API');
    });

    it('should handle multiple aliases for same entity', () => {
      const content = 'The JS framework uses ECMAScript standards';
      const entities = [
        { name: 'JavaScript', path: 'JavaScript.md', aliases: ['JS', 'ECMAScript'] }
      ];
      const suggestions = suggestWikilinks(content, entities, { firstOccurrenceOnly: false });

      expect(suggestions).toHaveLength(2);
      expect(suggestions.every(s => s.entity === 'JavaScript')).toBe(true);
    });

    it('should suggest first occurrence only across name and aliases', () => {
      const content = 'JS is fun. JavaScript is powerful.';
      const entities = [
        { name: 'JavaScript', path: 'JavaScript.md', aliases: ['JS'] }
      ];
      const suggestions = suggestWikilinks(content, entities, { firstOccurrenceOnly: true });

      // Only first match (JS) should be suggested
      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].entity).toBe('JavaScript');
      expect(suggestions[0].start).toBe(0); // JS is at the start
    });

    it('should prioritize longer alias matches', () => {
      const content = 'Working with API Management and the API';
      const entities = [
        { name: 'API', path: 'API.md', aliases: [] },
        { name: 'API Management Platform', path: 'API Management Platform.md', aliases: ['API Management'] }
      ];
      const suggestions = suggestWikilinks(content, entities);

      // Should have both suggestions
      expect(suggestions).toHaveLength(2);
      // First suggestion should be for the longer match
      const apiMgmtSuggestion = suggestions.find(s => s.entity === 'API Management Platform');
      const apiSuggestion = suggestions.find(s => s.entity === 'API');
      expect(apiMgmtSuggestion).toBeDefined();
      expect(apiSuggestion).toBeDefined();
    });

    it('should work with string entities mixed with object entities', () => {
      const content = 'Using React and the PRD';
      const entities = [
        'React',
        { name: 'Product Requirements Document', path: 'Product Requirements Document.md', aliases: ['PRD'] }
      ];
      const suggestions = suggestWikilinks(content, entities);

      expect(suggestions).toHaveLength(2);
      expect(suggestions.map(s => s.entity)).toContain('React');
      expect(suggestions.map(s => s.entity)).toContain('Product Requirements Document');
    });

    it('should find alias case-insensitively', () => {
      const content = 'Check the prd for details';
      const entities = [
        { name: 'Product Requirements Document', path: 'Product Requirements Document.md', aliases: ['PRD'] }
      ];
      const suggestions = suggestWikilinks(content, entities, { caseInsensitive: true });

      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].entity).toBe('Product Requirements Document');
    });
  });
});

describe('detectImplicitEntities', () => {
  describe('proper nouns pattern', () => {
    it('should detect multi-word proper nouns', () => {
      const content = 'I discussed the project with Marcus Johnson yesterday.';
      const matches = detectImplicitEntities(content);

      expect(matches).toHaveLength(1);
      expect(matches[0].text).toBe('Marcus Johnson');
      expect(matches[0].pattern).toBe('proper-nouns');
    });

    it('should detect multiple proper nouns', () => {
      const content = 'Project Alpha is led by Sarah Connor and John Smith.';
      const matches = detectImplicitEntities(content);

      expect(matches).toHaveLength(3);
      expect(matches.map(m => m.text)).toContain('Project Alpha');
      expect(matches.map(m => m.text)).toContain('Sarah Connor');
      expect(matches.map(m => m.text)).toContain('John Smith');
    });

    it('should detect three-word proper nouns', () => {
      const content = 'Visit San Francisco Bay to see the bridge.';
      const matches = detectImplicitEntities(content);

      expect(matches).toHaveLength(1);
      expect(matches[0].text).toBe('San Francisco Bay');
    });

    it('should exclude patterns starting with The/A/An', () => {
      const content = 'The Quick Fox jumped over A Lazy Dog.';
      const matches = detectImplicitEntities(content);

      // Should not match "The Quick Fox" or "A Lazy Dog"
      expect(matches.map(m => m.text)).not.toContain('The Quick Fox');
      expect(matches.map(m => m.text)).not.toContain('A Lazy Dog');
    });

    it('should exclude patterns starting with This/That', () => {
      const content = 'This Monday we meet. That Tuesday is free.';
      const matches = detectImplicitEntities(content);

      expect(matches.map(m => m.text)).not.toContain('This Monday');
      expect(matches.map(m => m.text)).not.toContain('That Tuesday');
    });
  });

  describe('quoted terms pattern', () => {
    it('should detect quoted terms as implicit entities', () => {
      const content = 'We need to test the "Turbopump" component next week.';
      const matches = detectImplicitEntities(content);

      // Quoted-terms pattern detects quoted text as entities
      expect(matches.map(m => m.text)).toContain('Turbopump');
      expect(matches.find(m => m.text === 'Turbopump')?.pattern).toBe('quoted-terms');
    });

    it('should not detect very long prose in quotes', () => {
      // Regex limits to 3-30 chars, so long prose won't match
      const content = 'He said "This is a very long sentence that exceeds the thirty character limit for quoted terms" today.';
      const matches = detectImplicitEntities(content);

      expect(matches.map(m => m.text)).not.toContain('This is a very long sentence that exceeds the thirty character limit for quoted terms');
    });
  });

  describe('single-caps pattern', () => {
    it('should detect single capitalized words after lowercase when enabled', () => {
      const content = 'I spoke with Marcus about the project.';
      const matches = detectImplicitEntities(content, {
        implicitPatterns: ['proper-nouns', 'single-caps']
      });

      expect(matches.map(m => m.text)).toContain('Marcus');
    });

    it('should not detect sentence starters', () => {
      // The pattern requires lowercase before the cap word
      const content = 'Marcus is here. Sarah left.';
      const matches = detectImplicitEntities(content, {
        implicitPatterns: ['single-caps']
      });

      // Both are at sentence start, no lowercase before them
      expect(matches).toHaveLength(0);
    });

    it('should not be enabled by default', () => {
      const content = 'I talked to Marcus yesterday.';
      const matchesDefault = detectImplicitEntities(content);
      const matchesWithSingleCaps = detectImplicitEntities(content, {
        implicitPatterns: ['proper-nouns', 'single-caps']
      });

      // Default should not have Marcus (single word)
      expect(matchesDefault.map(m => m.text)).not.toContain('Marcus');
      // With single-caps should have it
      expect(matchesWithSingleCaps.map(m => m.text)).toContain('Marcus');
    });
  });

  describe('protected zones', () => {
    it('should not detect entities inside code blocks', () => {
      const content = '```\nMarcus Johnson\n```\nOutside code';
      const matches = detectImplicitEntities(content);

      expect(matches.map(m => m.text)).not.toContain('Marcus Johnson');
    });

    it('should not detect entities inside existing wikilinks', () => {
      const content = 'See [[Marcus Johnson]] for details. Also John Smith.';
      const matches = detectImplicitEntities(content);

      // Marcus Johnson is in wikilink, should not be detected
      // John Smith should be detected
      expect(matches.map(m => m.text)).not.toContain('Marcus Johnson');
      expect(matches.map(m => m.text)).toContain('John Smith');
    });

    it('should not detect entities inside inline code', () => {
      const content = 'Run `Marcus Johnson` command and contact John Smith.';
      const matches = detectImplicitEntities(content);

      expect(matches.map(m => m.text)).not.toContain('Marcus Johnson');
      expect(matches.map(m => m.text)).toContain('John Smith');
    });
  });

  describe('deduplication', () => {
    it('should not return duplicate entities', () => {
      const content = 'Marcus Johnson met Marcus Johnson at the meeting.';
      const matches = detectImplicitEntities(content);

      // Should only have one instance
      expect(matches.filter(m => m.text === 'Marcus Johnson')).toHaveLength(1);
    });
  });

  describe('common word exclusion', () => {
    it('should exclude common words like Monday, January', () => {
      const content = 'Meeting with John Smith on Monday January 5th.';
      const matches = detectImplicitEntities(content, {
        implicitPatterns: ['proper-nouns', 'single-caps']
      });

      expect(matches.map(m => m.text)).toContain('John Smith');
      expect(matches.map(m => m.text)).not.toContain('Monday');
      expect(matches.map(m => m.text)).not.toContain('January');
    });
  });

  describe('overlap filtering', () => {
    it('should keep longer match when proper-nouns and single-caps overlap', () => {
      const content = 'Morning Briefing was productive today.';
      const matches = detectImplicitEntities(content, {
        implicitPatterns: ['proper-nouns', 'single-caps']
      });

      expect(matches.map(m => m.text)).toContain('Morning Briefing');
      expect(matches.map(m => m.text)).not.toContain('Briefing');
    });

    it('should not produce corrupted wikilinks like ]]ng]]', () => {
      const content = 'Morning Briefing (34.9s) was great.';
      const matches = detectImplicitEntities(content, {
        implicitPatterns: ['proper-nouns', 'single-caps']
      });

      // Apply matches in reverse order (simulating what processWikilinks does)
      let result = content;
      const sorted = [...matches].sort((a, b) => b.start - a.start);
      for (const m of sorted) {
        result = result.slice(0, m.start) + `[[${m.text}]]` + result.slice(m.end);
      }

      expect(result).toContain('[[Morning Briefing]]');
      expect(result).not.toMatch(/\]\]\w+\]\]/);
    });

    it('should keep non-overlapping matches from different patterns', () => {
      const content = 'Sam Altman discussed the Specialist Verticals topic.';
      const matches = detectImplicitEntities(content, {
        implicitPatterns: ['proper-nouns', 'single-caps']
      });

      expect(matches.map(m => m.text)).toContain('Sam Altman');
      expect(matches.map(m => m.text)).toContain('Specialist Verticals');
    });
  });

  describe('sentence starter filtering', () => {
    it('should exclude newly added sentence starter words from multi-word proper nouns', () => {
      const content = 'Target Alpha was the goal. Build Process is important.';
      const matches = detectImplicitEntities(content);

      // "Target" and "Build" are sentence starters, so "Target Alpha" should
      // become just "Alpha" (single word, dropped) and "Build Process" → "Process" (dropped)
      expect(matches.map(m => m.text)).not.toContain('Target Alpha');
      expect(matches.map(m => m.text)).not.toContain('Build Process');
    });

    it('should still detect proper nouns that are not sentence starters', () => {
      const content = 'Working with Marcus Johnson on the Alpha Project launch.';
      const matches = detectImplicitEntities(content);

      expect(matches.map(m => m.text)).toContain('Marcus Johnson');
      expect(matches.map(m => m.text)).toContain('Alpha Project');
    });
  });

  describe('acronym length filtering', () => {
    it('should detect short ALL-CAPS acronyms (3-5 chars)', () => {
      const content = 'The API uses ONNX and LLM for processing.';
      const matches = detectImplicitEntities(content, {
        implicitPatterns: ['acronyms']
      });

      expect(matches.map(m => m.text)).toContain('API');
      expect(matches.map(m => m.text)).toContain('ONNX');
      expect(matches.map(m => m.text)).toContain('LLM');
    });

    it('should NOT detect long ALL-CAPS words (>5 chars) as acronyms', () => {
      const content = 'See ARCHITECTURE and TESTING and TOOLS and README for details.';
      const matches = detectImplicitEntities(content, {
        implicitPatterns: ['acronyms']
      });

      expect(matches.map(m => m.text)).not.toContain('ARCHITECTURE');
      expect(matches.map(m => m.text)).not.toContain('TESTING');
      expect(matches.map(m => m.text)).not.toContain('README');
    });

    it('should detect exactly 5-char acronyms', () => {
      const content = 'The ONNX format is popular.';
      const matches = detectImplicitEntities(content, {
        implicitPatterns: ['acronyms']
      });

      expect(matches.map(m => m.text)).toContain('ONNX');
    });
  });

  describe('hyphenated descriptor exclusion', () => {
    it('should exclude lowercase hyphenated descriptors from entity matching', () => {
      const content = 'This is a local-first and self-improving system.';
      const entities = ['local-first', 'self-improving'];
      const result = applyWikilinks(content, entities);

      // Hyphenated lowercase words are descriptors, not entities
      expect(result.linksAdded).toBe(0);
      expect(result.content).not.toContain('[[local-first]]');
      expect(result.content).not.toContain('[[self-improving]]');
    });

    it('should NOT exclude mixed-case hyphenated entities', () => {
      // Mixed-case hyphenated entities like company names should still work
      const content = 'Using Hewlett-Packard equipment.';
      const entities = ['Hewlett-Packard'];
      const result = applyWikilinks(content, entities);

      expect(result.linksAdded).toBe(1);
      expect(result.content).toContain('[[Hewlett-Packard]]');
    });
  });

  describe('EXCLUDE_WORDS expansion', () => {
    it('should exclude common adjectives and verbs from entity linking', () => {
      const content = 'The target was to create a simple test and avoid a build.';
      const entities = ['target', 'create', 'simple', 'test', 'avoid', 'build'];
      const result = applyWikilinks(content, entities);

      expect(result.linksAdded).toBe(0);
    });
  });

  describe('regression: real entities still link correctly', () => {
    it('should still link real multi-word proper nouns', () => {
      const content = 'Meeting with John Smith about Project Alpha tomorrow.';
      const matches = detectImplicitEntities(content);

      expect(matches.map(m => m.text)).toContain('John Smith');
      expect(matches.map(m => m.text)).toContain('Project Alpha');
    });

    it('should still link real entities via applyWikilinks', () => {
      const content = 'Working with React and TypeScript on the API.';
      const entities = ['React', 'TypeScript', 'API'];
      const result = applyWikilinks(content, entities);

      expect(result.content).toContain('[[React]]');
      expect(result.content).toContain('[[TypeScript]]');
      expect(result.content).toContain('[[API]]');
      expect(result.linksAdded).toBe(3);
    });

    it('should still detect CamelCase words', () => {
      const content = 'Using TypeScript and HuggingFace for the project.';
      const matches = detectImplicitEntities(content, {
        implicitPatterns: ['camel-case']
      });

      expect(matches.map(m => m.text)).toContain('TypeScript');
      expect(matches.map(m => m.text)).toContain('HuggingFace');
    });
  });
});

describe('processWikilinks', () => {
  it('should work like applyWikilinks when detectImplicit is false', () => {
    const content = 'Working with React and some new concepts';
    const entities = ['React'];

    const applyResult = applyWikilinks(content, entities);
    const processResult = processWikilinks(content, entities, { detectImplicit: false });

    expect(processResult.content).toBe(applyResult.content);
    expect(processResult.linksAdded).toBe(applyResult.linksAdded);
  });

  it('should detect and link implicit entities when enabled', () => {
    const content = 'Using React with Marcus Johnson for Project Alpha.';
    const entities = ['React'];

    const result = processWikilinks(content, entities, { detectImplicit: true });

    expect(result.content).toContain('[[React]]');
    expect(result.content).toContain('[[Marcus Johnson]]');
    expect(result.content).toContain('[[Project Alpha]]');
    expect(result.implicitEntities).toContain('Marcus Johnson');
    expect(result.implicitEntities).toContain('Project Alpha');
  });

  it('should not duplicate link known entities as implicit', () => {
    const content = 'Working with Marcus Johnson on the project.';
    const entities = [
      { name: 'Marcus Johnson', path: 'Marcus Johnson.md', aliases: [] }
    ];

    const result = processWikilinks(content, entities, { detectImplicit: true });

    // Should be linked via known entities, not implicit
    expect(result.content).toContain('[[Marcus Johnson]]');
    expect(result.implicitEntities || []).not.toContain('Marcus Johnson');
  });

  it('should convert quoted terms to wikilinks', () => {
    const content = 'Testing the "Turbopump" component today.';
    const entities: string[] = [];

    const result = processWikilinks(content, entities, { detectImplicit: true });

    // Quoted-terms pattern replaces "Term" with [[Term]]
    expect(result.content).toContain('[[Turbopump]]');
    expect(result.implicitEntities).toContain('Turbopump');
  });

  it('should not link entities matching notePath', () => {
    const content = 'In Daily Note we track Daily activities.';
    const entities: string[] = [];

    const result = processWikilinks(content, entities, {
      detectImplicit: true,
      notePath: 'notes/Daily Note.md',
      implicitPatterns: ['proper-nouns', 'single-caps']
    });

    // Should not create self-link to Daily Note
    expect(result.implicitEntities || []).not.toContain('Daily Note');
  });

  it('should combine known and implicit entity counts', () => {
    const content = 'React is used by Marcus Johnson for Project Alpha.';
    const entities = ['React'];

    const result = processWikilinks(content, entities, { detectImplicit: true });

    // 1 known (React) + 2 implicit (Marcus Johnson, Project Alpha)
    expect(result.linksAdded).toBe(3);
    expect(result.linkedEntities).toContain('React');
    expect(result.implicitEntities).toHaveLength(2);
  });
});

describe('resolveAliasWikilinks', () => {
  it('should resolve alias wikilink to canonical entity', () => {
    const content = 'See [[model context protocol]] for details';
    const entities = [
      { name: 'MCP', path: 'MCP.md', aliases: ['Model Context Protocol'] }
    ];
    const result = resolveAliasWikilinks(content, entities);

    expect(result.content).toBe('See [[MCP|model context protocol]] for details');
    expect(result.linksAdded).toBe(1);
    expect(result.linkedEntities).toContain('MCP');
  });

  it('should preserve existing display text', () => {
    const content = 'See [[model context protocol|the protocol]] for details';
    const entities = [
      { name: 'MCP', path: 'MCP.md', aliases: ['Model Context Protocol'] }
    ];
    const result = resolveAliasWikilinks(content, entities);

    expect(result.content).toBe('See [[MCP|the protocol]] for details');
    expect(result.linksAdded).toBe(1);
  });

  it('should not modify wikilinks already using entity name', () => {
    const content = 'See [[MCP]] for details';
    const entities = [
      { name: 'MCP', path: 'MCP.md', aliases: ['Model Context Protocol'] }
    ];
    const result = resolveAliasWikilinks(content, entities);

    expect(result.content).toBe('See [[MCP]] for details');
    expect(result.linksAdded).toBe(0);
  });

  it('should handle multiple alias wikilinks', () => {
    const content = 'Using [[model context protocol]] with [[azure data factory]]';
    const entities = [
      { name: 'MCP', path: 'MCP.md', aliases: ['Model Context Protocol'] },
      { name: 'ADF', path: 'ADF.md', aliases: ['Azure Data Factory'] }
    ];
    const result = resolveAliasWikilinks(content, entities);

    expect(result.content).toContain('[[MCP|model context protocol]]');
    expect(result.content).toContain('[[ADF|azure data factory]]');
    expect(result.linksAdded).toBe(2);
    expect(result.linkedEntities).toContain('MCP');
    expect(result.linkedEntities).toContain('ADF');
  });

  it('should be case-insensitive by default', () => {
    const content = 'See [[MODEL CONTEXT PROTOCOL]] for info';
    const entities = [
      { name: 'MCP', path: 'MCP.md', aliases: ['Model Context Protocol'] }
    ];
    const result = resolveAliasWikilinks(content, entities);

    // Preserves user's original casing in display text
    expect(result.content).toBe('See [[MCP|MODEL CONTEXT PROTOCOL]] for info');
    expect(result.linksAdded).toBe(1);
  });

  it('should respect case-sensitive option when disabled', () => {
    const content = 'See [[MODEL CONTEXT PROTOCOL]] for info';
    const entities = [
      { name: 'MCP', path: 'MCP.md', aliases: ['Model Context Protocol'] }
    ];
    const result = resolveAliasWikilinks(content, entities, { caseInsensitive: false });

    // Should not resolve because case doesn't match exactly
    expect(result.content).toBe('See [[MODEL CONTEXT PROTOCOL]] for info');
    expect(result.linksAdded).toBe(0);
  });

  it('should not modify wikilinks that dont match any alias', () => {
    const content = 'See [[Unknown Entity]] for details';
    const entities = [
      { name: 'MCP', path: 'MCP.md', aliases: ['Model Context Protocol'] }
    ];
    const result = resolveAliasWikilinks(content, entities);

    expect(result.content).toBe('See [[Unknown Entity]] for details');
    expect(result.linksAdded).toBe(0);
  });

  it('should handle string entities (no aliases)', () => {
    const content = 'See [[React]] for details';
    const entities = ['React', 'TypeScript'];
    const result = resolveAliasWikilinks(content, entities);

    // String entities have no aliases, so nothing to resolve
    expect(result.content).toBe('See [[React]] for details');
    expect(result.linksAdded).toBe(0);
  });

  it('should handle wikilink with entity name as display text', () => {
    const content = 'See [[model context protocol|MCP]] for info';
    const entities = [
      { name: 'MCP', path: 'MCP.md', aliases: ['Model Context Protocol'] }
    ];
    const result = resolveAliasWikilinks(content, entities);

    // Target resolves to entity, preserves existing display text
    expect(result.content).toBe('See [[MCP|MCP]] for info');
    expect(result.linksAdded).toBe(1);
  });

  it('should handle empty entities array', () => {
    const content = 'See [[some link]] for details';
    const result = resolveAliasWikilinks(content, []);

    expect(result.content).toBe('See [[some link]] for details');
    expect(result.linksAdded).toBe(0);
  });

  it('should handle content with no wikilinks', () => {
    const content = 'Just plain text without any links';
    const entities = [
      { name: 'MCP', path: 'MCP.md', aliases: ['Model Context Protocol'] }
    ];
    const result = resolveAliasWikilinks(content, entities);

    expect(result.content).toBe('Just plain text without any links');
    expect(result.linksAdded).toBe(0);
  });

  it('should handle mixed resolved and unresolved wikilinks', () => {
    const content = 'Using [[model context protocol]] and [[React]] together';
    const entities = [
      { name: 'MCP', path: 'MCP.md', aliases: ['Model Context Protocol'] }
    ];
    const result = resolveAliasWikilinks(content, entities);

    expect(result.content).toBe('Using [[MCP|model context protocol]] and [[React]] together');
    expect(result.linksAdded).toBe(1);
  });
});

describe('applyWikilinks alreadyLinked option', () => {
  it('does not re-link an entity that was already linked by a prior step', () => {
    // Simulate: resolveAliasWikilinks already resolved [[OC-39181]] → [[OC39181|OC-39181]]
    // Step 2 (applyWikilinks) should NOT also insert [[OC39181]] for a later plain occurrence
    const contentAfterStep1 = 'Ticket [[OC39181|OC-39181]] was closed. Review OC39181 again later.';
    const entities = [{ name: 'OC39181', path: 'OC39181.md', aliases: ['OC-39181'] }];
    const step1Linked = new Set(['oc39181']);

    const result = applyWikilinks(contentAfterStep1, entities, {
      firstOccurrenceOnly: true,
      caseInsensitive: true,
      alreadyLinked: step1Linked,
    });

    // The existing piped link should remain unchanged
    expect(result.content).toContain('[[OC39181|OC-39181]]');
    // No bare [[OC39181]] should be inserted (entity already linked)
    expect(result.content.match(/\[\[OC39181/g)?.length).toBe(1);
    expect(result.linksAdded).toBe(0);
  });

  it('links entity when alreadyLinked is empty', () => {
    const content = 'Review OC39181 again later.';
    const entities = [{ name: 'OC39181', path: 'OC39181.md', aliases: ['OC-39181'] }];

    const result = applyWikilinks(content, entities, {
      firstOccurrenceOnly: true,
      alreadyLinked: new Set(),
    });

    expect(result.content).toContain('[[OC39181]]');
    expect(result.linksAdded).toBe(1);
  });

  it('combines resolveAliasWikilinks + applyWikilinks without double-linking', () => {
    // Full two-step simulation: the exact bug scenario for OC39181/OC-39181
    const originalContent = 'Ticket [[OC-39181]] was closed. Review OC39181 again later.';
    const entities = [{ name: 'OC39181', path: 'OC39181.md', aliases: ['OC-39181'] }];

    // Step 1: resolve alias wikilinks
    const resolved = resolveAliasWikilinks(originalContent, entities, { caseInsensitive: true });
    expect(resolved.content).toContain('[[OC39181|OC-39181]]');
    expect(resolved.linkedEntities).toContain('OC39181');

    // Step 2: apply wikilinks with step1 results fed in as alreadyLinked
    const step1Linked = new Set(resolved.linkedEntities.map(e => e.toLowerCase()));
    const final = applyWikilinks(resolved.content, entities, {
      firstOccurrenceOnly: true,
      caseInsensitive: true,
      alreadyLinked: step1Linked,
    });

    // Should have exactly one [[OC39181... link (the piped one from Step 1)
    expect(final.content).toContain('[[OC39181|OC-39181]]');
    expect(final.content.match(/\[\[OC39181/g)?.length).toBe(1);
    expect(final.linksAdded).toBe(0);
  });

  it('does not link entity already present in existing note content (cross-call deduplication)', () => {
    // Simulate: a prior vault_add_to_section call already linked OC39181 in a previous section.
    // When the next call processes new content, it should extract already-linked entities
    // from the existing note and add them to alreadyLinked, preventing double-linking.
    const existingNoteContent = 'Previous section.\n[[OC39181|OC-39181]] was closed.\n';
    const newSectionContent = 'Follow-up: OC39181 still needs review.';
    const entities = [{ name: 'OC39181', path: 'OC39181.md', aliases: ['OC-39181'] }];

    // Extract already-linked entities from existing content (as processWikilinks now does)
    const alreadyLinked = new Set<string>();
    for (const match of existingNoteContent.matchAll(/\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/g)) {
      alreadyLinked.add(match[1].toLowerCase());
    }
    expect(alreadyLinked.has('oc39181')).toBe(true);

    const result = applyWikilinks(newSectionContent, entities, {
      firstOccurrenceOnly: true,
      caseInsensitive: true,
      alreadyLinked,
    });

    // Entity already linked in note → should not be linked in new section
    expect(result.content).toBe(newSectionContent);
    expect(result.linksAdded).toBe(0);
  });

  it('still links entity when existing content has no prior link for it', () => {
    const existingNoteContent = 'Previous section with unrelated content.\n';
    const newSectionContent = 'Follow-up: OC39181 needs review.';
    const entities = [{ name: 'OC39181', path: 'OC39181.md', aliases: [] }];

    const alreadyLinked = new Set<string>();
    for (const match of existingNoteContent.matchAll(/\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/g)) {
      alreadyLinked.add(match[1].toLowerCase());
    }

    const result = applyWikilinks(newSectionContent, entities, {
      firstOccurrenceOnly: true,
      caseInsensitive: true,
      alreadyLinked,
    });

    expect(result.content).toContain('[[OC39181]]');
    expect(result.linksAdded).toBe(1);
  });
});

describe('P2/T3: Deduplication and format consistency', () => {
  it('same entity appears 3 times — only first is linked (firstOccurrenceOnly)', () => {
    const content = 'React is great. I love React. React rocks!';
    const entities = ['React'];
    const result = applyWikilinks(content, entities, { firstOccurrenceOnly: true });

    // Only the first occurrence should be linked
    expect(result.content).toBe('[[React]] is great. I love React. React rocks!');
    expect(result.linksAdded).toBe(1);

    // Count wikilinks: should be exactly 1
    const wikilinks = result.content.match(/\[\[React\]\]/g);
    expect(wikilinks).toHaveLength(1);
  });

  it('consistent format: alias entity linked via alias gets piped format only once', () => {
    // Entity "OC39181" has alias "OC-39181"
    // Text has: [[OC-39181]] (existing alias link), then "OC39181" (plain), then "OC-39181" (plain)
    const content = 'Ticket [[OC-39181]] was closed. Review OC39181 again. Also see OC-39181.';
    const entities = [{ name: 'OC39181', path: 'OC39181.md', aliases: ['OC-39181'] }];

    // Step 1: resolve alias wikilinks
    const resolved = resolveAliasWikilinks(content, entities, { caseInsensitive: true });

    // Step 2: apply with alreadyLinked from step 1
    const step1Linked = new Set(resolved.linkedEntities.map(e => e.toLowerCase()));
    const final = applyWikilinks(resolved.content, entities, {
      firstOccurrenceOnly: true,
      caseInsensitive: true,
      alreadyLinked: step1Linked,
    });

    // Should have exactly one piped wikilink from Step 1, no additional bare wikilinks
    const allLinks = final.content.match(/\[\[OC39181[^\]]*\]\]/g) || [];
    expect(allLinks).toHaveLength(1);
    expect(allLinks[0]).toBe('[[OC39181|OC-39181]]');
  });

  it('no mixed formats: bare and piped links for same entity should not coexist', () => {
    // Simulate content that already has a bare [[React]] link
    const content = 'Using [[React]] for the UI. Also React is great.';
    const entities = [{ name: 'React', path: 'React.md', aliases: [] }];

    // Extract already-linked from existing content
    const alreadyLinked = new Set<string>();
    for (const match of content.matchAll(/\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/g)) {
      alreadyLinked.add(match[1].toLowerCase());
    }

    const result = applyWikilinks(content, entities, {
      firstOccurrenceOnly: true,
      caseInsensitive: true,
      alreadyLinked,
    });

    // Should not add a second link — entity is already linked
    expect(result.linksAdded).toBe(0);
    expect(result.content).toBe(content);

    // Only one [[React]] in the output
    const reactLinks = result.content.match(/\[\[React[^\]]*\]\]/g) || [];
    expect(reactLinks).toHaveLength(1);
  });
});

describe('AST zones: wikilinks integration', () => {
  it('does not insert links inside nested callouts', () => {
    const content = `> [!note] Important
> Machine Learning is used here
> > [!warning] Caution
> > Artificial Intelligence warning

Machine Learning is also mentioned outside`;

    const entities = ['Machine Learning', 'Artificial Intelligence'];
    const result = applyWikilinks(content, entities);

    // Should link entities outside callout
    expect(result.content).toContain('[[Machine Learning]] is also mentioned outside');
    // Should NOT link entities inside the callout
    const calloutPart = result.content.split('\n\n')[0];
    expect(calloutPart).not.toContain('[[Machine Learning]]');
    expect(calloutPart).not.toContain('[[Artificial Intelligence]]');
  });

  it('does not insert links inside GFM tables', () => {
    const content = `# Overview

| Name | Description |
|------|-------------|
| Machine Learning | A subset of AI |
| TypeScript | A typed language |

Machine Learning is powerful.`;

    const entities = ['Machine Learning', 'TypeScript'];
    const result = applyWikilinks(content, entities);

    // Should link entities outside table
    expect(result.content).toContain('[[Machine Learning]] is powerful');
    // Should NOT link inside table cells
    const tablePart = result.content.split('\n\n')[1];
    expect(tablePart).not.toContain('[[Machine Learning]]');
    expect(tablePart).not.toContain('[[TypeScript]]');
  });

  it('does not insert links inside multi-line HTML comments', () => {
    const content = `Text before

<!-- This comment mentions
Machine Learning and
Artificial Intelligence -->

Machine Learning is great outside the comment`;

    const entities = ['Machine Learning', 'Artificial Intelligence'];
    const result = applyWikilinks(content, entities);

    // Should link outside
    expect(result.content).toContain('[[Machine Learning]] is great outside');
    // Should NOT link inside HTML comment
    const commentPart = result.content.slice(
      result.content.indexOf('<!--'),
      result.content.indexOf('-->') + 3
    );
    expect(commentPart).not.toContain('[[Machine Learning]]');
    expect(commentPart).not.toContain('[[Artificial Intelligence]]');
  });
});

describe('noise reduction', () => {
  describe('T1: minimum alias length guard', () => {
    it('should not match single-char aliases like "I" for Ben', () => {
      const result = applyWikilinks('I went to the store', [{ name: 'Ben', aliases: ['I'] }]);
      expect(result.content).toBe('I went to the store');
      expect(result.linksAdded).toBe(0);
    });

    it('should not match two-char common-word aliases like "us" and "me"', () => {
      const result = applyWikilinks('Tell us about me', [
        { name: 'USA', aliases: ['us'] },
        { name: 'Ben', aliases: ['me'] },
      ]);
      expect(result.content).toBe('Tell us about me');
      expect(result.linksAdded).toBe(0);
    });

    it('should still match two-char non-common aliases like JS', () => {
      const result = applyWikilinks('The JS framework', [{ name: 'JavaScript', aliases: ['JS'] }]);
      expect(result.content).toContain('[[JavaScript|JS]]');
      expect(result.linksAdded).toBe(1);
    });
  });

  describe('T2: EXCLUDE_WORDS expansion', () => {
    it('should not match common words used as entity names', () => {
      const words = ['walk', 'rest', 'share', 'surface', 'cover', 'skip'];
      for (const word of words) {
        const result = applyWikilinks(`I need to ${word} now`, [word]);
        expect(result.linksAdded).toBe(0);
      }
    });

    it('should not match common words used as entity aliases', () => {
      const result = applyWikilinks('Time for a walk and some rest', [
        { name: 'Go for a walk', aliases: ['walk'] },
        { name: 'REST API', aliases: ['rest'] },
      ]);
      expect(result.linksAdded).toBe(0);
    });

    it('should still match proper entity names not in EXCLUDE_WORDS', () => {
      const result = applyWikilinks('Working on Flywheel today', ['Flywheel']);
      expect(result.content).toContain('[[Flywheel]]');
      expect(result.linksAdded).toBe(1);
    });
  });

  describe('T3: cross-line matching prevention', () => {
    it('should not match proper nouns across newlines', () => {
      const result = detectImplicitEntities('Cover\nVandalism promise');
      const names = result.map(m => m.text);
      expect(names).not.toContain('Cover Vandalism');
      expect(names).not.toContain('Cover\nVandalism');
    });

    it('should not match across newlines in multi-line text', () => {
      const result = detectImplicitEntities('Hastings Direct\nThanks for choosing');
      const names = result.map(m => m.text);
      expect(names).not.toContain('Hastings Direct Thanks');
      expect(names).not.toContain('Hastings Direct\nThanks');
    });

    it('should still match proper nouns on the same line', () => {
      const result = detectImplicitEntities('met with Marcus Johnson yesterday');
      const names = result.map(m => m.text);
      expect(names).toContain('Marcus Johnson');
    });
  });

  describe('T4: sentence starter trimming', () => {
    it('should trim "So" from proper noun matches', () => {
      const result = detectImplicitEntities('So Fartimus Venturi is here');
      const names = result.map(m => m.text);
      expect(names).not.toContain('So Fartimus Venturi');
    });

    it('should trim "Hello" from proper noun matches', () => {
      const result = detectImplicitEntities('Hello Ben Smith arrived');
      const names = result.map(m => m.text);
      expect(names).not.toContain('Hello Ben Smith');
    });

    it('should trim "Mr" from proper noun matches', () => {
      const result = detectImplicitEntities('Mr Ben Cassie signed');
      const names = result.map(m => m.text);
      expect(names).not.toContain('Mr Ben Cassie');
    });

    it('should trim "How" and keep multi-word remainder', () => {
      const result = detectImplicitEntities('it is about How To Approach Them');
      const names = result.map(m => m.text);
      expect(names).not.toContain('How To Approach Them');
    });

    it('should trim "Skip" and skip single-word remainder', () => {
      const result = detectImplicitEntities('about Skip Twitter today');
      const names = result.map(m => m.text);
      expect(names).not.toContain('Skip Twitter');
    });
  });

  describe('T5: IMPLICIT_EXCLUDE_WORDS expansion', () => {
    it('should not detect common adjectives as implicit entities via single-caps', () => {
      // single-caps pattern requires lowercase char + space before the capitalized word
      const adjectives = ['Comprehensive', 'Enhanced', 'Protected', 'Missing', 'Direct'];
      for (const adj of adjectives) {
        const result = detectImplicitEntities(`text goes ${adj} review of things`);
        const names = result.map(m => m.text);
        expect(names).not.toContain(adj);
      }
    });

    it('should not detect common past participles as implicit entities', () => {
      const result = detectImplicitEntities('text goes Discussed the plan with team');
      const names = result.map(m => m.text);
      expect(names).not.toContain('Discussed');
    });

    it('should still detect real proper nouns via proper-nouns pattern', () => {
      // proper-nouns is in the default config (multi-word capitalized phrases)
      const result = detectImplicitEntities('talked with Marcus Johnson yesterday');
      const names = result.map(m => m.text);
      expect(names).toContain('Marcus Johnson');
    });
  });

  describe('T6: pure punctuation exclusion', () => {
    it('should not detect quoted punctuation like "* + *" as entities', () => {
      // Regression: markdown italic markers inside quotes were matched by quoted-terms
      const content = '*"Cognitive sovereignty for your Obsidian vault."* + *"All yours"*';
      const result = detectImplicitEntities(content);
      const names = result.map(m => m.text);
      expect(names).not.toContain('* + *');
    });

    it('should not detect pure symbols as entities', () => {
      const result = detectImplicitEntities('symbols like "+++" and "---" are not entities');
      const names = result.map(m => m.text);
      expect(names).not.toContain('+++');
      expect(names).not.toContain('---');
    });

    it('should still detect real quoted terms', () => {
      const result = detectImplicitEntities('the concept of "Cognitive Sovereignty" matters');
      const names = result.map(m => m.text);
      expect(names).toContain('Cognitive Sovereignty');
    });
  });
});

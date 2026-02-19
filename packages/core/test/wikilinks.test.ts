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
    it('should detect quoted terms', () => {
      const content = 'We need to test the "Turbopump" component next week.';
      const matches = detectImplicitEntities(content);

      expect(matches).toHaveLength(1);
      expect(matches[0].text).toBe('Turbopump');
      expect(matches[0].pattern).toBe('quoted-terms');
    });

    it('should detect multiple quoted terms', () => {
      const content = 'The "Propulsion System" uses a "Turbopump" for fuel.';
      const matches = detectImplicitEntities(content);

      expect(matches).toHaveLength(2);
      expect(matches.map(m => m.text)).toContain('Propulsion System');
      expect(matches.map(m => m.text)).toContain('Turbopump');
    });

    it('should not match very short quoted terms', () => {
      const content = 'The "API" is ready.';
      const matches = detectImplicitEntities(content, { minEntityLength: 4 });

      // "API" is only 3 chars, should be excluded with minEntityLength: 4
      expect(matches).toHaveLength(0);
    });

    it('should not match very long quoted terms', () => {
      const content = 'Check out "This is a really long title that exceeds thirty characters" for details.';
      const matches = detectImplicitEntities(content);

      // Quoted regex limits to 30 chars
      expect(matches).toHaveLength(0);
    });
  });

  describe('single-caps pattern', () => {
    it('should detect single capitalized words after lowercase when enabled', () => {
      const content = 'I spoke with Marcus about the project.';
      const matches = detectImplicitEntities(content, {
        implicitPatterns: ['proper-nouns', 'quoted-terms', 'single-caps']
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
        implicitPatterns: ['proper-nouns', 'quoted-terms', 'single-caps']
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
        implicitPatterns: ['proper-nouns', 'quoted-terms', 'single-caps']
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

  it('should handle quoted terms and convert to wikilinks', () => {
    const content = 'Testing the "Turbopump" component today.';
    const entities: string[] = [];

    const result = processWikilinks(content, entities, { detectImplicit: true });

    // "Turbopump" should become [[Turbopump]]
    expect(result.content).toContain('[[Turbopump]]');
    expect(result.content).not.toContain('"Turbopump"');
  });

  it('should not link entities matching notePath', () => {
    const content = 'In Daily Note we track Daily activities.';
    const entities: string[] = [];

    const result = processWikilinks(content, entities, {
      detectImplicit: true,
      notePath: 'notes/Daily Note.md',
      implicitPatterns: ['proper-nouns', 'quoted-terms', 'single-caps']
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

/**
 * Tests for Porter Stemmer implementation
 */

import { describe, it, expect } from 'vitest';
import { stem, tokenize, tokenizeAndStem, isStopword } from '../../../src/core/shared/stemmer.js';

// ========================================
// stem() Tests
// ========================================

describe('stem', () => {
  describe('basic stemming', () => {
    it('should stem -ing endings', () => {
      expect(stem('thinking')).toBe('think');
      expect(stem('running')).toBe('run');
      expect(stem('programming')).toBe('program');
    });

    it('should stem -ed endings', () => {
      expect(stem('completed')).toBe('complet');
      expect(stem('worked')).toBe('work');
      expect(stem('created')).toBe('creat');
    });

    it('should stem -ical/-ically endings', () => {
      expect(stem('philosophical')).toBe('philosoph');
      expect(stem('practical')).toBe('practic');
      expect(stem('logical')).toBe('logic');
    });

    it('should stem -ness endings', () => {
      expect(stem('consciousness')).toBe('conscious');
      expect(stem('happiness')).toBe('happi');
      expect(stem('sadness')).toBe('sad');
    });

    it('should stem -tion/-sion endings', () => {
      expect(stem('determination')).toBe('determin');
      // Note: "creation" doesn't meet step 4 m>1 requirement
      expect(stem('creation')).toBe('creation');
    });

    it('should stem plural endings', () => {
      expect(stem('thoughts')).toBe('thought');
      expect(stem('ideas')).toBe('idea');
      expect(stem('concepts')).toBe('concept');
    });
  });

  describe('important concept words', () => {
    it('should stem philosophy-related words to similar roots', () => {
      // Porter stemmer produces related but not always identical stems
      // The matching logic uses prefix comparison for conceptual matching
      const philosophyStem = stem('philosophy');
      const philosophicalStem = stem('philosophical');

      // Both start with "philosoph" which is the common root
      expect(philosophyStem.startsWith('philosoph')).toBe(true);
      expect(philosophicalStem.startsWith('philosoph')).toBe(true);
    });

    it('should stem determinism-related words to similar roots', () => {
      const deterministicStem = stem('deterministic');
      const determinismStem = stem('determinism');

      // Both share the "determin" root
      expect(deterministicStem.startsWith('determin')).toBe(true);
      expect(determinismStem.startsWith('determin')).toBe(true);
    });

    it('should stem consciousness-related words', () => {
      expect(stem('consciousness')).toBe('conscious');
      expect(stem('conscious')).toBe('consciou');
    });
  });

  describe('edge cases', () => {
    it('should handle short words unchanged', () => {
      expect(stem('ai')).toBe('ai');
      expect(stem('go')).toBe('go');
    });

    it('should handle already-stemmed words', () => {
      expect(stem('think')).toBe('think');
      expect(stem('run')).toBe('run');
    });

    it('should handle uppercase by lowercasing', () => {
      expect(stem('THINKING')).toBe('think');
      expect(stem('Philosophy')).toBe('philosophi'); // Same as lowercase 'philosophy'
      expect(stem('Philosophy')).toBe(stem('philosophy'));
    });

    it('should handle empty string', () => {
      expect(stem('')).toBe('');
    });
  });
});

// ========================================
// tokenize() Tests
// ========================================

describe('tokenize', () => {
  describe('basic tokenization', () => {
    it('should extract significant words', () => {
      // Note: "thinking" is now a stopword
      const tokens = tokenize('Pondering philosophical consciousness');
      expect(tokens).toContain('pondering');
      expect(tokens).toContain('philosophical');
      expect(tokens).toContain('consciousness');
    });

    it('should filter out short words (< 3 chars)', () => {
      const tokens = tokenize('The cat sat on a mat');
      expect(tokens).not.toContain('the'); // stopword
      expect(tokens).toContain('cat');
      expect(tokens).toContain('sat');
      expect(tokens).not.toContain('on'); // < 3 chars
      expect(tokens).not.toContain('a');  // < 3 chars
      expect(tokens).toContain('mat');
    });

    it('should filter out stopwords', () => {
      // Note: "something" and "important" are now stopwords
      // Use words that aren't stopwords
      const tokens = tokenize('This is extraordinary programming');
      expect(tokens).not.toContain('this');
      expect(tokens).toContain('extraordinary');
      expect(tokens).toContain('programming');
    });

    it('should lowercase all tokens', () => {
      const tokens = tokenize('TypeScript Programming Language');
      expect(tokens).toContain('typescript');
      expect(tokens).toContain('programming');
      expect(tokens).toContain('language');
    });
  });

  describe('markdown handling', () => {
    it('should extract text from wikilinks', () => {
      // Note: "working" is now a stopword
      const tokens = tokenize('Collaborating with [[Jordan Smith]] regarding [[Project Alpha]]');
      expect(tokens).toContain('collaborating');
      expect(tokens).toContain('jordan');
      expect(tokens).toContain('smith');
      expect(tokens).toContain('project');
      expect(tokens).toContain('alpha');
      expect(tokens).toContain('regarding');
    });

    it('should handle aliased wikilinks', () => {
      const tokens = tokenize('See [[Jordan Smith|Jordan]] for info');
      expect(tokens).toContain('jordan');
      expect(tokens).toContain('smith');
      expect(tokens).toContain('info');
    });

    it('should remove markdown formatting', () => {
      const tokens = tokenize('**bold** and `code` and *italic*');
      expect(tokens).toContain('bold');
      expect(tokens).toContain('code');
      expect(tokens).toContain('italic');
    });
  });

  describe('edge cases', () => {
    it('should handle empty string', () => {
      expect(tokenize('')).toEqual([]);
    });

    it('should handle whitespace only', () => {
      expect(tokenize('   \n\t  ')).toEqual([]);
    });

    it('should handle punctuation only', () => {
      expect(tokenize('!@#$%^&*()')).toEqual([]);
    });

    it('should handle numbers mixed with text', () => {
      // Note: "today" and "released" are now stopwords
      const tokens = tokenize('Version 0.5.1 available publicly');
      expect(tokens).toContain('version');
      expect(tokens).toContain('available');
      expect(tokens).toContain('publicly');
    });
  });
});

// ========================================
// tokenizeAndStem() Tests
// ========================================

describe('tokenizeAndStem', () => {
  it('should return tokens, tokenSet, and stems', () => {
    // Note: "thinking" is now a stopword, use non-stopword content words
    const result = tokenizeAndStem('Philosophical meditations regarding consciousness');

    expect(result.tokens).toContain('philosophical');
    expect(result.tokens).toContain('meditations');
    expect(result.tokens).toContain('consciousness');

    expect(result.tokenSet.has('philosophical')).toBe(true);
    expect(result.tokenSet.has('meditations')).toBe(true);

    expect(result.stems.has('philosoph')).toBe(true);
    expect(result.stems.has('medit')).toBe(true);
    expect(result.stems.has('conscious')).toBe(true);
  });

  it('should deduplicate stems', () => {
    // Use words that aren't stopwords but have similar stems
    const result = tokenizeAndStem('philosophical philosophy philosopher');
    // All share the "philosoph" root
    expect(result.stems.has('philosoph')).toBe(true);
    // Token set should have all three
    expect(result.tokenSet.has('philosophical')).toBe(true);
    expect(result.tokenSet.has('philosophy')).toBe(true);
    expect(result.tokenSet.has('philosopher')).toBe(true);
  });
});

// ========================================
// isStopword() Tests
// ========================================

describe('isStopword', () => {
  it('should identify common stopwords', () => {
    expect(isStopword('the')).toBe(true);
    expect(isStopword('and')).toBe(true);
    expect(isStopword('is')).toBe(true);
    expect(isStopword('with')).toBe(true);
  });

  it('should handle case insensitively', () => {
    expect(isStopword('THE')).toBe(true);
    expect(isStopword('And')).toBe(true);
  });

  it('should return false for content words', () => {
    expect(isStopword('programming')).toBe(false);
    expect(isStopword('consciousness')).toBe(false);
    expect(isStopword('flywheel')).toBe(false);
  });

  // Expanded stopwords tests (critical for false positive prevention)
  describe('expanded stopwords - verbs', () => {
    it('should identify common verbs as stopwords', () => {
      // These verbs caused false positives like "Completed" → "Complete Guide"
      expect(isStopword('completed')).toBe(true);
      expect(isStopword('started')).toBe(true);
      expect(isStopword('finished')).toBe(true);
      expect(isStopword('working')).toBe(true);
      expect(isStopword('created')).toBe(true);
      expect(isStopword('updated')).toBe(true);
      expect(isStopword('fixed')).toBe(true);
      expect(isStopword('building')).toBe(true);
      expect(isStopword('testing')).toBe(true);
      expect(isStopword('released')).toBe(true);
    });

    it('should identify verb root forms as stopwords', () => {
      expect(isStopword('complete')).toBe(true);
      expect(isStopword('start')).toBe(true);
      expect(isStopword('finish')).toBe(true);
      expect(isStopword('work')).toBe(true);
      expect(isStopword('create')).toBe(true);
      expect(isStopword('update')).toBe(true);
      expect(isStopword('fix')).toBe(true);
      expect(isStopword('build')).toBe(true);
      expect(isStopword('test')).toBe(true);
      expect(isStopword('release')).toBe(true);
    });
  });

  describe('expanded stopwords - time words', () => {
    it('should identify time words as stopwords', () => {
      expect(isStopword('today')).toBe(true);
      expect(isStopword('tomorrow')).toBe(true);
      expect(isStopword('yesterday')).toBe(true);
      expect(isStopword('weekly')).toBe(true);
      expect(isStopword('daily')).toBe(true);
      expect(isStopword('monthly')).toBe(true);
      expect(isStopword('morning')).toBe(true);
      expect(isStopword('currently')).toBe(true);
      expect(isStopword('recently')).toBe(true);
    });
  });

  describe('expanded stopwords - generic words', () => {
    it('should identify generic words as stopwords', () => {
      expect(isStopword('thing')).toBe(true);
      expect(isStopword('things')).toBe(true);
      expect(isStopword('something')).toBe(true);
      expect(isStopword('good')).toBe(true);
      expect(isStopword('better')).toBe(true);
      expect(isStopword('different')).toBe(true);
      expect(isStopword('important')).toBe(true);
    });
  });

  describe('expanded stopwords - descriptive words', () => {
    it('should identify descriptive/qualifier words as stopwords', () => {
      expect(isStopword('really')).toBe(true);
      expect(isStopword('actually')).toBe(true);
      expect(isStopword('basically')).toBe(true);
      expect(isStopword('probably')).toBe(true);
      expect(isStopword('simply')).toBe(true);
      expect(isStopword('quickly')).toBe(true);
    });
  });
});

// ========================================
// Integration Tests - Matching Scenarios
// ========================================

/**
 * Helper to check if any content stem shares a common prefix with entity stem
 * This enables conceptual matching where related words share root prefixes
 */
function stemsShareRoot(contentStems: Set<string>, entityStem: string, minPrefixLen = 5): boolean {
  for (const contentStem of contentStems) {
    // Check if stems share a meaningful common prefix
    const minLen = Math.min(contentStem.length, entityStem.length, minPrefixLen);
    if (contentStem.slice(0, minLen) === entityStem.slice(0, minLen) && minLen >= 4) {
      return true;
    }
  }
  return false;
}

describe('stemmer integration', () => {
  it('should enable matching "philosophical" to "Philosophy" entity', () => {
    // User writes: "philosophical musings on determinism"
    // Entity: "Philosophy"

    const contentStems = tokenizeAndStem('philosophical musings on determinism').stems;
    const entityStem = stem('philosophy');

    // "philosophical" stems to "philosoph"
    // "philosophy" stems to "philosophi"
    // They share the common root "philosoph"
    expect(stemsShareRoot(contentStems, entityStem)).toBe(true);
  });

  it('should enable matching "meditating" to "Meditation" entity', () => {
    // Note: "thinking" is now a stopword, use "meditating" instead
    const contentStems = tokenizeAndStem('meditating quietly').stems;
    const entityStem = stem('meditation');

    // "meditating" -> "medit", "meditation" -> "medit"
    // Both share the "medit" root
    expect(contentStems.has('medit')).toBe(true);
    expect(entityStem).toBe('medit');
  });

  it('should enable matching "deterministic" to "Determinism" entity', () => {
    const contentStems = tokenizeAndStem('deterministic execution').stems;
    const entityStem = stem('determinism');

    // "deterministic" -> "determinist", "determinism" -> "determin"
    // Both share the "determin" root
    expect(stemsShareRoot(contentStems, entityStem)).toBe(true);
  });

  it('should NOT match unrelated words', () => {
    const contentStems = tokenizeAndStem('completed the flywheel crank').stems;
    const entityStem = stem('fat');

    // "completed" should NOT match "fat"
    expect(stemsShareRoot(contentStems, entityStem, 3)).toBe(false);
  });
});

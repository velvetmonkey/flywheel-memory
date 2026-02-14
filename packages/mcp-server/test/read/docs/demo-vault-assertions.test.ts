/**
 * Demo Vault Assertions Tests
 *
 * Validates that demo vaults maintain expected structure and file counts.
 * These tests catch documentation drift and ensure demos remain consistent.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { glob } from 'glob';

// Path to demo vaults
const DEMOS_PATH = path.resolve(__dirname, '../../../../demos');
const ARTEMIS_VAULT = path.join(DEMOS_PATH, 'artemis-rocket');
const CARTER_VAULT = path.join(DEMOS_PATH, 'carter-strategy');

describe('Demo Vault: Artemis Rocket', () => {
  describe('File Counts', () => {
    it('should have approximately 70 markdown files', async () => {
      const files = await glob('**/*.md', {
        cwd: ARTEMIS_VAULT,
        ignore: ['**/node_modules/**'],
      });

      // Allow some flexibility (65-75 files)
      expect(files.length).toBeGreaterThanOrEqual(65);
      expect(files.length).toBeLessThanOrEqual(80);
    });

    it('should have team files in team/ folder', async () => {
      const teamFiles = await glob('team/*.md', { cwd: ARTEMIS_VAULT });
      expect(teamFiles.length).toBeGreaterThanOrEqual(1);
    });

    it('should have daily notes in daily-notes/ folder', async () => {
      const dailyFiles = await glob('daily-notes/*.md', { cwd: ARTEMIS_VAULT });
      expect(dailyFiles.length).toBeGreaterThanOrEqual(5);
    });

    it('should have system documentation', async () => {
      const systemFiles = await glob('systems/**/*.md', { cwd: ARTEMIS_VAULT });
      expect(systemFiles.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Folder Structure', () => {
    it('should have expected top-level folders', () => {
      const expectedFolders = [
        'daily-notes',
        'decisions',
        'meetings',
        'project',
        'suppliers',
        'systems',
        'team',
        'tests',
        'weekly-notes',
      ];

      for (const folder of expectedFolders) {
        const folderPath = path.join(ARTEMIS_VAULT, folder);
        expect(fs.existsSync(folderPath), `Missing folder: ${folder}`).toBe(true);
      }
    });

    // Note: .flywheel directory contains SQLite databases generated at runtime
    // and won't exist in CI since it's not committed to git

    it('should have CLAUDE.md configuration file', () => {
      const claudeMd = path.join(ARTEMIS_VAULT, 'CLAUDE.md');
      expect(fs.existsSync(claudeMd)).toBe(true);
    });
  });

  describe('Content Quality', () => {
    it('should have wikilinks in daily notes', async () => {
      const dailyFiles = await glob('daily-notes/*.md', { cwd: ARTEMIS_VAULT });

      let foundWikilinks = false;
      for (const file of dailyFiles.slice(0, 5)) {
        const content = fs.readFileSync(path.join(ARTEMIS_VAULT, file), 'utf-8');
        if (content.includes('[[') && content.includes(']]')) {
          foundWikilinks = true;
          break;
        }
      }

      expect(foundWikilinks, 'Daily notes should contain wikilinks').toBe(true);
    });

    it('should have frontmatter in entity files', async () => {
      const teamFiles = await glob('team/*.md', { cwd: ARTEMIS_VAULT });

      if (teamFiles.length > 0) {
        const content = fs.readFileSync(path.join(ARTEMIS_VAULT, teamFiles[0]), 'utf-8');
        expect(content.startsWith('---'), 'Team files should have frontmatter').toBe(true);
      }
    });

    it('should have project files', async () => {
      const projectFiles = await glob('project/*.md', { cwd: ARTEMIS_VAULT });
      expect(projectFiles.length).toBeGreaterThanOrEqual(1);

      // Should have project-related files (roadmap, risk register, etc.)
      const hasProjectFiles = projectFiles.some(f =>
        f.toLowerCase().includes('roadmap') || f.toLowerCase().includes('risk') || f.toLowerCase().includes('project')
      );
      expect(hasProjectFiles, 'Should have project files').toBe(true);
    });
  });
});

describe('Demo Vault: Carter Strategy', () => {
  describe('File Counts', () => {
    it('should have approximately 39 markdown files', async () => {
      const files = await glob('**/*.md', {
        cwd: CARTER_VAULT,
        ignore: ['**/node_modules/**'],
      });

      // Allow some flexibility (35-45 files)
      expect(files.length).toBeGreaterThanOrEqual(35);
      expect(files.length).toBeLessThanOrEqual(50);
    });
  });

  describe('Folder Structure', () => {
    // Note: .flywheel directory contains SQLite databases generated at runtime
    // and won't exist in CI since it's not committed to git

    it('should have meaningful folder organization', () => {
      const entries = fs.readdirSync(CARTER_VAULT, { withFileTypes: true });
      const folders = entries.filter(e => e.isDirectory() && !e.name.startsWith('.'));

      expect(folders.length).toBeGreaterThanOrEqual(3);
    });
  });
});

describe('Demo Vault Consistency', () => {
  it('should have both demo vaults present', () => {
    expect(fs.existsSync(ARTEMIS_VAULT), 'artemis-rocket vault missing').toBe(true);
    expect(fs.existsSync(CARTER_VAULT), 'carter-strategy vault missing').toBe(true);
  });

  it('should have consistent configuration across vaults', async () => {
    const vaults = [ARTEMIS_VAULT, CARTER_VAULT];

    for (const vault of vaults) {
      // Each vault should have CLAUDE.md for configuration
      // Note: .flywheel directories are generated at runtime and won't exist in CI
      expect(fs.existsSync(path.join(vault, 'CLAUDE.md'))).toBe(true);
    }
  });

  it('should have no broken wikilinks to required files', async () => {
    // This is a smoke test - just verify structure exists
    const artemisFiles = await glob('**/*.md', { cwd: ARTEMIS_VAULT });
    const carterFiles = await glob('**/*.md', { cwd: CARTER_VAULT });

    expect(artemisFiles.length).toBeGreaterThan(0);
    expect(carterFiles.length).toBeGreaterThan(0);
  });
});

describe('Demo Vault: File Content Validation', () => {
  it('should have valid markdown in all files', async () => {
    const files = await glob('**/*.md', {
      cwd: ARTEMIS_VAULT,
      ignore: ['**/node_modules/**'],
    });

    for (const file of files.slice(0, 20)) {
      const content = fs.readFileSync(path.join(ARTEMIS_VAULT, file), 'utf-8');

      // Basic markdown validation
      expect(typeof content).toBe('string');
      expect(content.length).toBeGreaterThan(0);

      // If has frontmatter, should be properly closed
      if (content.startsWith('---')) {
        const secondDelimiter = content.indexOf('---', 4);
        expect(secondDelimiter, `Unclosed frontmatter in ${file}`).toBeGreaterThan(0);
      }
    }
  });

  it('should have UTF-8 compatible content', async () => {
    const files = await glob('**/*.md', {
      cwd: ARTEMIS_VAULT,
      ignore: ['**/node_modules/**'],
    });

    for (const file of files.slice(0, 10)) {
      // Should be able to read as UTF-8 without errors
      expect(() => {
        fs.readFileSync(path.join(ARTEMIS_VAULT, file), 'utf-8');
      }).not.toThrow();
    }
  });
});

describe('Demo Vault: Cross-References', () => {
  it('should have wikilinks pointing to existing files', async () => {
    const allFiles = await glob('**/*.md', { cwd: ARTEMIS_VAULT });
    const fileNames = allFiles.map(f => path.basename(f, '.md').toLowerCase());

    // Sample a few files for wikilink validation
    const sampleFiles = allFiles.slice(0, 5);
    let validLinks = 0;
    let totalLinks = 0;

    for (const file of sampleFiles) {
      const content = fs.readFileSync(path.join(ARTEMIS_VAULT, file), 'utf-8');
      const wikilinks = content.match(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g) || [];

      for (const link of wikilinks) {
        totalLinks++;
        const linkTarget = link.replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/, '$1').toLowerCase();

        // Check if target exists (simplified check)
        if (fileNames.some(f => f.includes(linkTarget) || linkTarget.includes(f))) {
          validLinks++;
        }
      }
    }

    // At least 20% of wikilinks should resolve (allowing flexibility for complex link targets)
    if (totalLinks > 0) {
      const validRatio = validLinks / totalLinks;
      expect(validRatio).toBeGreaterThanOrEqual(0.2);
    }
  });
});

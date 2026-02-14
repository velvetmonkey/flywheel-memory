/**
 * Tests for path filtering
 */

import { describe, it, expect } from 'vitest';
import {
  shouldWatch,
  normalizePath,
  getRelativePath,
} from '../../../src/core/watch/pathFilter.js';

describe('normalizePath', () => {
  it('should convert backslashes to forward slashes', () => {
    // On Windows, paths are also lowercased for case-insensitive comparison
    const expected = process.platform === 'win32'
      ? 'path/to/file.md'  // Already lowercase
      : 'path/to/file.md';
    expect(normalizePath('path\\to\\file.md')).toBe(expected);

    const expectedWin = process.platform === 'win32'
      ? 'c:/users/vault/note.md'  // Lowercased on Windows
      : 'C:/Users/vault/note.md';
    expect(normalizePath('C:\\Users\\vault\\note.md')).toBe(expectedWin);
  });

  it('should handle already-normalized paths', () => {
    expect(normalizePath('path/to/file.md')).toBe('path/to/file.md');
  });
});

describe('shouldWatch', () => {
  describe('markdown files', () => {
    it('should accept .md files', () => {
      expect(shouldWatch('note.md')).toBe(true);
      expect(shouldWatch('folder/note.md')).toBe(true);
      expect(shouldWatch('deep/nested/folder/note.md')).toBe(true);
    });

    it('should accept .MD files (case insensitive)', () => {
      expect(shouldWatch('NOTE.MD')).toBe(true);
      expect(shouldWatch('folder/Note.Md')).toBe(true);
    });
  });

  describe('ignored directories', () => {
    it('should reject .git paths', () => {
      expect(shouldWatch('.git/config')).toBe(false);
      expect(shouldWatch('.git/objects/note.md')).toBe(false);
    });

    it('should reject .obsidian paths', () => {
      expect(shouldWatch('.obsidian/plugins/plugin.md')).toBe(false);
      expect(shouldWatch('.obsidian/workspace.md')).toBe(false);
    });

    it('should reject .trash paths', () => {
      expect(shouldWatch('.trash/deleted.md')).toBe(false);
      expect(shouldWatch('.Trash/deleted.md')).toBe(false);
    });

    it('should reject node_modules paths', () => {
      expect(shouldWatch('node_modules/package/readme.md')).toBe(false);
    });

    it('should reject .vscode paths', () => {
      expect(shouldWatch('.vscode/settings.md')).toBe(false);
    });

    it('should reject .claude paths', () => {
      expect(shouldWatch('.claude/config.md')).toBe(false);
    });
  });

  describe('non-markdown files', () => {
    it('should reject image files', () => {
      expect(shouldWatch('image.png')).toBe(false);
      expect(shouldWatch('photo.jpg')).toBe(false);
      expect(shouldWatch('icon.svg')).toBe(false);
    });

    it('should reject document files', () => {
      expect(shouldWatch('doc.pdf')).toBe(false);
      expect(shouldWatch('sheet.xlsx')).toBe(false);
    });

    it('should reject audio/video files', () => {
      expect(shouldWatch('audio.mp3')).toBe(false);
      expect(shouldWatch('video.mp4')).toBe(false);
    });

    it('should reject temp/backup files', () => {
      expect(shouldWatch('file.tmp')).toBe(false);
      expect(shouldWatch('file.bak')).toBe(false);
      expect(shouldWatch('file~')).toBe(false);
    });

    it('should reject data files', () => {
      expect(shouldWatch('config.json')).toBe(false);
      expect(shouldWatch('data.yaml')).toBe(false);
    });

    it('should reject code files', () => {
      expect(shouldWatch('script.js')).toBe(false);
      expect(shouldWatch('module.ts')).toBe(false);
      expect(shouldWatch('main.py')).toBe(false);
    });
  });

  describe('hidden files', () => {
    it('should reject dotfiles', () => {
      expect(shouldWatch('.hidden.md')).toBe(false);
      expect(shouldWatch('.gitignore')).toBe(false);
    });

    it('should reject Emacs lock files', () => {
      expect(shouldWatch('.#note.md')).toBe(false);
    });

    it('should reject Vim swap files', () => {
      expect(shouldWatch('.note.md.swp')).toBe(false);
    });
  });

  describe('system files', () => {
    it('should reject .DS_Store', () => {
      expect(shouldWatch('.DS_Store')).toBe(false);
      expect(shouldWatch('folder/.DS_Store')).toBe(false);
    });

    it('should reject Thumbs.db', () => {
      expect(shouldWatch('Thumbs.db')).toBe(false);
      expect(shouldWatch('thumbs.DB')).toBe(false);
    });

    it('should reject desktop.ini', () => {
      expect(shouldWatch('desktop.ini')).toBe(false);
      expect(shouldWatch('Desktop.ini')).toBe(false);
    });
  });

  describe('with vault path', () => {
    const vaultPath = '/home/user/vault';

    it('should correctly calculate relative paths', () => {
      expect(shouldWatch('/home/user/vault/note.md', vaultPath)).toBe(true);
      expect(shouldWatch('/home/user/vault/folder/note.md', vaultPath)).toBe(true);
    });

    it('should reject ignored directories in vault', () => {
      expect(shouldWatch('/home/user/vault/.git/config', vaultPath)).toBe(false);
      expect(shouldWatch('/home/user/vault/.obsidian/file.md', vaultPath)).toBe(false);
    });
  });
});

describe('getRelativePath', () => {
  it('should calculate relative path', () => {
    expect(getRelativePath('/vault', '/vault/note.md')).toBe('note.md');
    expect(getRelativePath('/vault', '/vault/folder/note.md')).toBe('folder/note.md');
  });

  it('should normalize the result', () => {
    // On Windows, this would have backslashes
    const result = getRelativePath('/vault', '/vault/folder/note.md');
    expect(result).not.toContain('\\');
  });
});

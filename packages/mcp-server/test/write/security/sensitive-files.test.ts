/**
 * Security tests for sensitive file protection
 *
 * Validates that vault mutations are blocked for:
 * - Environment files (.env, .env.local, .env.production)
 * - Certificate and key files (.pem, .key, .p12, .pfx, .jks)
 * - Credential files (credentials.json, secrets.yaml)
 * - Git configuration (.git/config, .git/credentials)
 * - SSH keys (id_rsa, id_ed25519, id_ecdsa)
 * - System password files (.htpasswd, shadow, passwd)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  validatePathSecure,
  isSensitivePath,
} from '../../src/core/writer.js';
import {
  createTempVault,
  cleanupTempVault,
} from '../helpers/testUtils.js';

describe('Sensitive File Protection', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  // ========================================
  // Environment Files
  // ========================================

  describe('Environment files (.env)', () => {
    it('should block .env file', () => {
      expect(isSensitivePath('.env')).toBe(true);
    });

    it('should block .env.local', () => {
      expect(isSensitivePath('.env.local')).toBe(true);
    });

    it('should block .env.production', () => {
      expect(isSensitivePath('.env.production')).toBe(true);
    });

    it('should block .env.development', () => {
      expect(isSensitivePath('.env.development')).toBe(true);
    });

    it('should block nested .env files', () => {
      expect(isSensitivePath('config/.env')).toBe(true);
      expect(isSensitivePath('app/config/.env.local')).toBe(true);
    });

    it('should NOT block files that happen to contain "env" in name', () => {
      expect(isSensitivePath('environment-notes.md')).toBe(false);
      expect(isSensitivePath('my-env-setup.md')).toBe(false);
    });
  });

  // ========================================
  // Certificate and Key Files
  // ========================================

  describe('Certificate and key files', () => {
    it('should block .pem files', () => {
      expect(isSensitivePath('server.pem')).toBe(true);
      expect(isSensitivePath('certs/ca.pem')).toBe(true);
    });

    it('should block .key files', () => {
      expect(isSensitivePath('private.key')).toBe(true);
      expect(isSensitivePath('ssl/server.key')).toBe(true);
    });

    it('should block .p12 files', () => {
      expect(isSensitivePath('certificate.p12')).toBe(true);
    });

    it('should block .pfx files (Windows certificates)', () => {
      expect(isSensitivePath('cert.pfx')).toBe(true);
    });

    it('should block .jks files (Java keystore)', () => {
      expect(isSensitivePath('keystore.jks')).toBe(true);
    });

    it('should NOT block markdown files about keys', () => {
      expect(isSensitivePath('keyboard-shortcuts.md')).toBe(false);
      expect(isSensitivePath('api-key-management.md')).toBe(false);
    });
  });

  // ========================================
  // Credential Files
  // ========================================

  describe('Credential files', () => {
    it('should block credentials.json', () => {
      expect(isSensitivePath('credentials.json')).toBe(true);
      expect(isSensitivePath('gcp/credentials.json')).toBe(true);
    });

    it('should block secrets.json', () => {
      expect(isSensitivePath('secrets.json')).toBe(true);
    });

    it('should block secrets.yaml', () => {
      expect(isSensitivePath('secrets.yaml')).toBe(true);
      expect(isSensitivePath('secrets.yml')).toBe(true);
    });

    it('should block .htpasswd', () => {
      expect(isSensitivePath('.htpasswd')).toBe(true);
      expect(isSensitivePath('apache/.htpasswd')).toBe(true);
    });

    it('should NOT block note files about credentials', () => {
      expect(isSensitivePath('credential-rotation-notes.md')).toBe(false);
    });
  });

  // ========================================
  // Git Configuration
  // ========================================

  describe('Git configuration files', () => {
    it('should block .git/config', () => {
      expect(isSensitivePath('.git/config')).toBe(true);
    });

    it('should block .git/credentials', () => {
      expect(isSensitivePath('.git/credentials')).toBe(true);
    });

    it('should NOT block regular git-related notes', () => {
      expect(isSensitivePath('git-workflow.md')).toBe(false);
      expect(isSensitivePath('notes/git-config.md')).toBe(false);
    });
  });

  // ========================================
  // SSH Keys
  // ========================================

  describe('SSH key files', () => {
    it('should block id_rsa', () => {
      expect(isSensitivePath('id_rsa')).toBe(true);
      expect(isSensitivePath('.ssh/id_rsa')).toBe(true);
    });

    it('should block id_ed25519', () => {
      expect(isSensitivePath('id_ed25519')).toBe(true);
      expect(isSensitivePath('.ssh/id_ed25519')).toBe(true);
    });

    it('should block id_ecdsa', () => {
      expect(isSensitivePath('id_ecdsa')).toBe(true);
      expect(isSensitivePath('.ssh/id_ecdsa')).toBe(true);
    });

    it('should NOT block notes about SSH', () => {
      expect(isSensitivePath('ssh-setup-guide.md')).toBe(false);
    });
  });

  // ========================================
  // System Password Files
  // ========================================

  describe('System password files', () => {
    it('should block shadow file', () => {
      expect(isSensitivePath('shadow')).toBe(true);
      expect(isSensitivePath('/etc/shadow')).toBe(true);
    });

    it('should block passwd file', () => {
      expect(isSensitivePath('passwd')).toBe(true);
      expect(isSensitivePath('/etc/passwd')).toBe(true);
    });
  });

  // ========================================
  // Async Validation (validatePathSecure)
  // ========================================

  describe('validatePathSecure async validation', () => {
    it('should reject .env files with proper reason', async () => {
      const result = await validatePathSecure(tempVault, '.env');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('sensitive');
    });

    it('should reject credential files with proper reason', async () => {
      const result = await validatePathSecure(tempVault, 'credentials.json');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('sensitive');
    });

    it('should reject key files with proper reason', async () => {
      const result = await validatePathSecure(tempVault, 'server.key');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('sensitive');
    });

    it('should allow normal markdown files', async () => {
      const result = await validatePathSecure(tempVault, 'notes/my-note.md');
      expect(result.valid).toBe(true);
    });

    it('should allow nested vault paths', async () => {
      const result = await validatePathSecure(tempVault, 'projects/alpha/notes.md');
      expect(result.valid).toBe(true);
    });
  });

  // ========================================
  // Case Insensitivity
  // ========================================

  describe('Case insensitivity', () => {
    it('should block .ENV (uppercase)', () => {
      expect(isSensitivePath('.ENV')).toBe(true);
    });

    it('should block .Env.Local (mixed case)', () => {
      expect(isSensitivePath('.Env.Local')).toBe(true);
    });

    it('should block CREDENTIALS.JSON (uppercase)', () => {
      expect(isSensitivePath('CREDENTIALS.JSON')).toBe(true);
    });

    it('should block Server.PEM (mixed case)', () => {
      expect(isSensitivePath('Server.PEM')).toBe(true);
    });
  });

  // ========================================
  // Windows Path Normalization
  // ========================================

  describe('Windows path normalization', () => {
    it('should block .env with Windows backslashes', () => {
      expect(isSensitivePath('config\\.env')).toBe(true);
    });

    it('should block credentials.json with Windows backslashes', () => {
      expect(isSensitivePath('gcp\\credentials.json')).toBe(true);
    });

    it('should block .git\\config with Windows backslashes', () => {
      expect(isSensitivePath('.git\\config')).toBe(true);
    });
  });
});

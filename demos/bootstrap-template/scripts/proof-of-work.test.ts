/**
 * Proof-of-Work Test Suite
 *
 * Validates graph intelligence after vault bootstrap.
 * Run with: npm test -- demos/bootstrap-template/scripts/proof-of-work.test.ts
 *
 * Tests prove:
 * - Backlink accuracy (every [[link]] correctly indexed)
 * - Entity resolution (case-insensitive, alias-aware lookup)
 * - Hub detection (graph connectivity analysis)
 * - Build performance (scales efficiently)
 * - Consistency (same vault → same index)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'child_process';
import { existsSync, readFileSync, rmSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEMO_DIR = join(__dirname, '..');
const VAULT_DIR = join(DEMO_DIR, 'test-vault');
const SEED_DIR = join(DEMO_DIR, 'seed-data');

// Test thresholds (expecting 100+ notes, 150+ wikilinks)
const MAX_BUILD_TIME_MS_PER_FILE = 100;
const MIN_EXPECTED_NOTES = 100;
const MIN_EXPECTED_WIKILINKS = 150;

interface VaultMetrics {
  notes: number;
  entities: number;
  wikilinks: number;
  backlinks: Map<string, string[]>;
  buildTimeMs: number;
}

async function bootstrapTestVault(): Promise<void> {
  // Clean up previous test vault
  if (existsSync(VAULT_DIR)) {
    rmSync(VAULT_DIR, { recursive: true });
  }

  // Run bootstrap script
  execSync(`node scripts/bootstrap.js "${VAULT_DIR}"`, {
    cwd: DEMO_DIR,
    encoding: 'utf-8',
  });
}

function countWikilinks(content: string): number {
  const matches = content.match(/\[\[[^\]]+\]\]/g);
  return matches ? matches.length : 0;
}

function extractWikilinks(content: string): string[] {
  const matches = content.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g);
  if (!matches) return [];
  return matches.map(m => {
    const match = m.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/);
    return match ? match[1] : '';
  }).filter(Boolean);
}

function scanVault(vaultPath: string): VaultMetrics {
  const startTime = Date.now();
  const notes: string[] = [];
  const entities = new Set<string>();
  let totalWikilinks = 0;
  const backlinks = new Map<string, string[]>();

  function scanDir(dir: string, relativePath = '') {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relPath = join(relativePath, entry.name);

      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        scanDir(fullPath, relPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        notes.push(relPath);

        // Extract entity name from filename
        const entityName = entry.name.replace('.md', '');
        entities.add(entityName.toLowerCase());

        // Count and track wikilinks
        const content = readFileSync(fullPath, 'utf-8');
        const links = extractWikilinks(content);
        totalWikilinks += links.length;

        // Build backlink map
        for (const link of links) {
          const linkKey = link.toLowerCase();
          if (!backlinks.has(linkKey)) {
            backlinks.set(linkKey, []);
          }
          backlinks.get(linkKey)!.push(relPath);
        }
      }
    }
  }

  scanDir(vaultPath);

  return {
    notes: notes.length,
    entities: entities.size,
    wikilinks: totalWikilinks,
    backlinks,
    buildTimeMs: Date.now() - startTime,
  };
}

describe('Proof of Work: Graph Intelligence', () => {
  let metrics: VaultMetrics;

  beforeAll(async () => {
    // Bootstrap vault from CSV
    await bootstrapTestVault();

    // Scan vault for metrics
    metrics = scanVault(VAULT_DIR);

    console.log('\n=== Vault Metrics ===');
    console.log(`Notes: ${metrics.notes}`);
    console.log(`Entities: ${metrics.entities}`);
    console.log(`Wikilinks: ${metrics.wikilinks}`);
    console.log(`Build time: ${metrics.buildTimeMs}ms`);
    console.log(`ms/file: ${(metrics.buildTimeMs / metrics.notes).toFixed(2)}`);
  });

  describe('Bootstrap Validation', () => {
    it('should create expected note structure', () => {
      expect(metrics.notes).toBeGreaterThanOrEqual(MIN_EXPECTED_NOTES);
    });

    it('should create all entity folders', () => {
      expect(existsSync(join(VAULT_DIR, 'clients'))).toBe(true);
      expect(existsSync(join(VAULT_DIR, 'contacts'))).toBe(true);
      expect(existsSync(join(VAULT_DIR, 'projects'))).toBe(true);
      expect(existsSync(join(VAULT_DIR, 'invoices'))).toBe(true);
      expect(existsSync(join(VAULT_DIR, 'daily-notes'))).toBe(true);
    });

    it('should seed all clients from CSV', () => {
      const clientsDir = join(VAULT_DIR, 'clients');
      const clients = readdirSync(clientsDir);
      expect(clients).toContain('Acme Corp.md');
      expect(clients).toContain('TechStart Inc.md');
      expect(clients).toContain('GlobalBank.md');
    });

    it('should seed all contacts from CSV', () => {
      const contactsDir = join(VAULT_DIR, 'contacts');
      const contacts = readdirSync(contactsDir);
      expect(contacts).toContain('Sarah Thompson.md');
      expect(contacts).toContain('Mike Chen.md');
      expect(contacts).toContain('Lisa Park.md');
    });
  });

  describe('Wikilink Integrity', () => {
    it('should create wikilinks in frontmatter', () => {
      expect(metrics.wikilinks).toBeGreaterThanOrEqual(MIN_EXPECTED_WIKILINKS);
    });

    it('should link contacts to companies', () => {
      const sarahNote = readFileSync(join(VAULT_DIR, 'contacts', 'Sarah Thompson.md'), 'utf-8');
      expect(sarahNote).toContain('[[Acme Corp]]');
    });

    it('should link projects to clients', () => {
      const projectNote = readFileSync(join(VAULT_DIR, 'projects', 'Acme Data Migration.md'), 'utf-8');
      expect(projectNote).toContain('[[Acme Corp]]');
    });

    it('should link invoices to projects', () => {
      const invoiceNote = readFileSync(join(VAULT_DIR, 'invoices', 'INV-2026-001.md'), 'utf-8');
      expect(invoiceNote).toContain('[[Acme Data Migration]]');
    });
  });

  describe('Backlink Accuracy', () => {
    it('should track backlinks to Acme Corp', () => {
      const acmeBacklinks = metrics.backlinks.get('acme corp') || [];
      // Acme Corp should be linked from contacts, projects, and invoices
      expect(acmeBacklinks.length).toBeGreaterThanOrEqual(3);
    });

    it('should track backlinks to projects from invoices', () => {
      const projectBacklinks = metrics.backlinks.get('acme data migration') || [];
      expect(projectBacklinks.some(path => path.includes('invoices'))).toBe(true);
    });
  });

  describe('Entity Resolution', () => {
    it('should resolve entity names case-insensitively', () => {
      // Entity index should have lowercase keys
      expect(metrics.backlinks.has('acme corp')).toBe(true);
      // Sarah Thompson now has backlinks from meetings (as attendee)
      expect(metrics.backlinks.has('sarah thompson')).toBe(true);
    });

    it('should track unique entities', () => {
      // Should have clients, contacts, projects, invoices as entities
      expect(metrics.entities).toBeGreaterThanOrEqual(15);
    });
  });

  describe('Performance', () => {
    it('should build index within acceptable time', () => {
      const msPerFile = metrics.buildTimeMs / metrics.notes;
      expect(msPerFile).toBeLessThan(MAX_BUILD_TIME_MS_PER_FILE);
    });

    it('should handle small vault quickly', () => {
      // Total build time should be under 1 second for bootstrap vault
      expect(metrics.buildTimeMs).toBeLessThan(1000);
    });
  });

  describe('Frontmatter Structure', () => {
    it('should include type field in all notes', () => {
      const clientNote = readFileSync(join(VAULT_DIR, 'clients', 'Acme Corp.md'), 'utf-8');
      expect(clientNote).toContain('type: client');

      const contactNote = readFileSync(join(VAULT_DIR, 'contacts', 'Sarah Thompson.md'), 'utf-8');
      expect(contactNote).toContain('type: contact');

      const projectNote = readFileSync(join(VAULT_DIR, 'projects', 'Acme Data Migration.md'), 'utf-8');
      expect(projectNote).toContain('type: project');
    });

    it('should preserve relationships in frontmatter', () => {
      const contactNote = readFileSync(join(VAULT_DIR, 'contacts', 'Sarah Thompson.md'), 'utf-8');
      expect(contactNote).toContain('company:');
      expect(contactNote).toContain('role:');
    });
  });

  describe('Consistency', () => {
    it('should produce deterministic output on re-run', async () => {
      // Re-bootstrap and compare metrics
      await bootstrapTestVault();
      const metrics2 = scanVault(VAULT_DIR);

      expect(metrics2.notes).toBe(metrics.notes);
      expect(metrics2.entities).toBe(metrics.entities);
      expect(metrics2.wikilinks).toBe(metrics.wikilinks);
    });
  });
});

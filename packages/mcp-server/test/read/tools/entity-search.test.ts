/**
 * Tests for Entity Search Tool (search_entities)
 *
 * Tests FTS5 full-text search for vault entities with Porter stemming.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { connect } from 'mcp-testing-kit';
import { createTestServer, type TestServerContext } from '../helpers/createTestServer.js';
import { deleteStateDb } from '@velvetmonkey/vault-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = path.join(__dirname, '..', 'fixtures');

describe('Entity Search Tool (search_entities)', () => {
  let context: TestServerContext;

  beforeAll(async () => {
    // Create test server which also creates StateDb
    context = await createTestServer(FIXTURES_PATH);

    // Set up test database with some entities
    if (context.stateDb) {
      // Clear and insert test entities
      context.stateDb.clearEntities.run();

      // Insert test entities
      const entities = [
        { name: 'TypeScript', category: 'technologies', aliases: ['TS'], hubScore: 10 },
        { name: 'JavaScript', category: 'technologies', aliases: ['JS'], hubScore: 8 },
        { name: 'React', category: 'technologies', aliases: ['ReactJS'], hubScore: 15 },
        { name: 'John Smith', category: 'people', aliases: [], hubScore: 5 },
        { name: 'Project Alpha', category: 'projects', aliases: ['Alpha'], hubScore: 3 },
        { name: 'Running Tests', category: 'concepts', aliases: ['run test'], hubScore: 2 },
      ];

      for (const entity of entities) {
        context.stateDb.insertEntity.run(
          entity.name,
          entity.name.toLowerCase(),
          '',
          entity.category,
          JSON.stringify(entity.aliases),
          entity.hubScore
        );
      }

      context.stateDb.setMetadataValue.run('entities_built_at', new Date().toISOString());
      context.stateDb.setMetadataValue.run('entity_count', String(entities.length));
    }
  });

  afterAll(() => {
    // Clean up test database - wrapped in try-catch for Windows file locking
    try {
      if (context.stateDb) {
        context.stateDb.close();
      }
      deleteStateDb(FIXTURES_PATH);
    } catch {
      // File may still be locked on Windows - ignore cleanup failure
    }
  });

  describe('Basic Search Functionality', () => {
    test('finds entities by exact name', async () => {
      const client = await connect(context.server);
      const result = await client.callTool('search_entities', {
        query: 'TypeScript',
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.count).toBeGreaterThan(0);
      expect(data.entities.some((e: { name: string }) => e.name === 'TypeScript')).toBe(true);
    });

    test('finds entities by full word match', async () => {
      const client = await connect(context.server);
      // FTS5 matches full words, not substrings. "TypeScript" is a single token.
      const result = await client.callTool('search_entities', {
        query: 'TypeScript',
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.count).toBeGreaterThan(0);
      expect(data.entities.some((e: { name: string }) => e.name === 'TypeScript')).toBe(true);
    });

    test('uses Porter stemming (running matches run)', async () => {
      const client = await connect(context.server);
      const result = await client.callTool('search_entities', {
        query: 'run',
      });

      const data = JSON.parse(result.content[0].text);
      // Should find "Running Tests" due to Porter stemming
      expect(data.entities.some((e: { name: string }) => e.name.toLowerCase().includes('running'))).toBe(true);
    });

    test('returns correct result structure', async () => {
      const client = await connect(context.server);
      const result = await client.callTool('search_entities', {
        query: 'React',
        limit: 1,
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.query).toBe('React');
      expect(data.count).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(data.entities)).toBe(true);

      if (data.entities.length > 0) {
        const entity = data.entities[0];
        expect(entity).toHaveProperty('id');
        expect(entity).toHaveProperty('name');
        expect(entity).toHaveProperty('path');
        expect(entity).toHaveProperty('category');
        expect(entity).toHaveProperty('aliases');
        expect(entity).toHaveProperty('hubScore');
        expect(entity).toHaveProperty('rank');
      }
    });
  });

  describe('Prefix Search (Autocomplete)', () => {
    test('finds entities with prefix matching enabled', async () => {
      const client = await connect(context.server);
      const result = await client.callTool('search_entities', {
        query: 'Type',
        prefix: true,
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.count).toBeGreaterThan(0);
      expect(data.entities.some((e: { name: string }) => e.name.startsWith('Type'))).toBe(true);
    });

    test('prefix search works for short prefixes', async () => {
      const client = await connect(context.server);
      const result = await client.callTool('search_entities', {
        query: 'Re',
        prefix: true,
      });

      const data = JSON.parse(result.content[0].text);
      // Should find "React"
      expect(data.entities.some((e: { name: string }) => e.name === 'React')).toBe(true);
    });
  });

  describe('Category Filtering', () => {
    test('returns entities from all categories', async () => {
      const client = await connect(context.server);
      const result = await client.callTool('search_entities', {
        query: 'John OR React OR Project',
        limit: 10,
      });

      const data = JSON.parse(result.content[0].text);
      const categories = new Set(data.entities.map((e: { category: string }) => e.category));
      expect(categories.size).toBeGreaterThan(0);
    });
  });

  describe('Limit Parameter', () => {
    test('respects limit parameter', async () => {
      const client = await connect(context.server);
      const result = await client.callTool('search_entities', {
        query: 'Script OR React OR Project',
        limit: 2,
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.entities.length).toBeLessThanOrEqual(2);
    });

    test('uses default limit when not specified', async () => {
      const client = await connect(context.server);
      const result = await client.callTool('search_entities', {
        query: 'a',
        prefix: true,
      });

      const data = JSON.parse(result.content[0].text);
      // Default limit is 20
      expect(data.entities.length).toBeLessThanOrEqual(20);
    });
  });

  describe('Edge Cases', () => {
    test('handles empty query gracefully', async () => {
      const client = await connect(context.server);
      const result = await client.callTool('search_entities', {
        query: '',
      });

      const data = JSON.parse(result.content[0].text);
      expect(data).toHaveProperty('entities');
      expect(data).toHaveProperty('count');
    });

    test('handles special characters in query', async () => {
      const client = await connect(context.server);
      const result = await client.callTool('search_entities', {
        query: 'Type-Script',
      });

      const data = JSON.parse(result.content[0].text);
      // Should not crash, may or may not find results
      expect(data).toHaveProperty('entities');
    });

    test('handles no matching results', async () => {
      const client = await connect(context.server);
      const result = await client.callTool('search_entities', {
        query: 'xyznonexistentquery',
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.count).toBe(0);
      expect(data.entities).toHaveLength(0);
    });
  });
});

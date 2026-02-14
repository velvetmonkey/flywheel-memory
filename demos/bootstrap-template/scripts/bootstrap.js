#!/usr/bin/env node
/**
 * Bootstrap a Flywheel vault from CSV seed data
 *
 * This script reads CSV files from seed-data/ and generates
 * markdown notes with proper frontmatter for Flywheel indexing.
 *
 * Usage:
 *   node bootstrap.js [output-dir]
 *
 * Default output: ./vault
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const seedDir = join(__dirname, '..', 'seed-data');

function parseCSV(filename) {
  const content = readFileSync(join(seedDir, filename), 'utf-8');
  const lines = content.trim().split('\n');
  const headers = lines[0].split(',');

  return lines.slice(1).map(line => {
    const values = line.split(',');
    const row = {};
    headers.forEach((header, i) => {
      row[header.trim()] = values[i]?.trim() || '';
    });
    return row;
  });
}

function toYAML(obj) {
  return Object.entries(obj)
    .filter(([_, v]) => v !== '' && v !== undefined)
    .map(([k, v]) => {
      if (typeof v === 'number') return `${k}: ${v}`;
      if (v.startsWith('[[')) return `${k}: "${v}"`; // Preserve wikilinks
      return `${k}: ${v}`;
    })
    .join('\n');
}

function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function createNote(outputDir, folder, name, frontmatter, content = '') {
  const dir = join(outputDir, folder);
  ensureDir(dir);

  const filename = `${name}.md`;
  const filepath = join(dir, filename);

  const fm = toYAML(frontmatter);
  const note = `---
${fm}
---
# ${name}

${content}
`;

  writeFileSync(filepath, note);
  console.log(`Created: ${folder}/${filename}`);
}

function bootstrap(outputDir) {
  console.log(`\nBootstrapping vault to: ${outputDir}\n`);

  // Create folder structure
  ensureDir(join(outputDir, 'clients'));
  ensureDir(join(outputDir, 'contacts'));
  ensureDir(join(outputDir, 'projects'));
  ensureDir(join(outputDir, 'invoices'));
  ensureDir(join(outputDir, 'meetings'));
  ensureDir(join(outputDir, 'daily-notes'));

  // Process clients
  const clients = parseCSV('clients.csv');
  for (const client of clients) {
    createNote(outputDir, 'clients', client.name, {
      type: 'client',
      industry: client.industry,
      status: client.status,
      contract_type: client.contract_type || undefined,
      monthly_retainer: client.monthly_retainer ? parseInt(client.monthly_retainer) : undefined,
    }, `## Contacts

## Projects

## Notes
`);
  }

  // Process contacts
  const contacts = parseCSV('contacts.csv');
  for (const contact of contacts) {
    createNote(outputDir, 'contacts', contact.name, {
      type: 'contact',
      company: `[[${contact.company}]]`,
      role: contact.role,
      email: contact.email,
      relationship: contact.relationship,
    }, `## Interactions

## Notes
`);
  }

  // Process projects
  const projects = parseCSV('projects.csv');
  for (const project of projects) {
    createNote(outputDir, 'projects', project.name, {
      type: 'project',
      client: `[[${project.client}]]`,
      status: project.status,
      start_date: project.start_date,
      hourly_rate: project.hourly_rate ? parseInt(project.hourly_rate) : undefined,
      project_type: project.type,
    }, `## Scope

## Progress

## Tasks

## Notes
`);
  }

  // Process invoices
  const invoices = parseCSV('invoices.csv');
  for (const invoice of invoices) {
    createNote(outputDir, 'invoices', invoice.invoice_id, {
      type: 'invoice',
      client: `[[${invoice.client}]]`,
      project: `[[${invoice.project}]]`,
      amount: parseInt(invoice.amount),
      status: invoice.status,
      due_date: invoice.due_date,
    }, `## Line Items

## Notes
`);
  }

  // Process meetings
  const meetings = parseCSV('meetings.csv');
  for (const meeting of meetings) {
    // Parse attendees (semicolon-separated) into wikilinks
    const attendees = meeting.attendees.split(';')
      .map(a => `[[${a.trim()}]]`)
      .join(', ');

    createNote(outputDir, 'meetings', meeting.title, {
      type: 'meeting',
      date: meeting.date,
      time: meeting.time,
      client: `[[${meeting.client}]]`,
      project: `[[${meeting.project}]]`,
      meeting_type: meeting.type,
    }, `## Attendees
${attendees}

## Agenda

## Notes
${meeting.notes}

## Action Items
- [ ]
`);
  }

  // Create sample daily note
  const today = new Date().toISOString().split('T')[0];
  createNote(outputDir, 'daily-notes', today, {
    type: 'daily',
    date: today,
  }, `## Priorities

## Log

## Tasks
- [ ]

## Notes
`);

  console.log(`\n✓ Bootstrap complete!`);
  console.log(`\nNext steps:`);
  console.log(`  1. Point Flywheel at ${outputDir}`);
  console.log(`  2. Add content via Flywheel-Crank mutations`);
  console.log(`  3. Watch auto-wikilinks build the graph`);
}

// Main
const outputDir = process.argv[2] || join(__dirname, '..', 'vault');
bootstrap(outputDir);

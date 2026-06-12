/**
 * Note-from-template creation (arch-review S3).
 *
 * Moved verbatim from tools/write/mutations.ts — it was the single LIVE
 * dependency keeping that retired fork file imported (editSection.ts:42).
 * Periodic-note template resolution + minimal fallback + secure write.
 */

import fs from 'fs/promises';
import path from 'path';
import { writeVaultFile, validatePathSecure } from './writer.js';
import type { FlywheelConfig } from '../read/types.js';

/**
 * Create a note from template or minimal fallback.
 * Returns the path that was created.
 */
export async function createNoteFromTemplate(
  vaultPath: string,
  notePath: string,
  config: FlywheelConfig
): Promise<{ created: boolean; templateUsed?: string }> {
  // Validate path before any filesystem operations (secure: follows symlinks, blocks sensitive files)
  const validation = await validatePathSecure(vaultPath, notePath);
  if (!validation.valid) {
    throw new Error(`Path blocked: ${validation.reason}`);
  }

  const fullPath = path.join(vaultPath, notePath);

  // Ensure parent directories exist
  await fs.mkdir(path.dirname(fullPath), { recursive: true });

  // Try to find a matching template
  const templates = config.templates || {};
  const filename = path.basename(notePath, '.md').toLowerCase();

  // Determine which type of periodic note this might be
  let templatePath: string | undefined;
  let periodicType: string | undefined;
  const dailyPattern = /^\d{4}-\d{2}-\d{2}/;
  const weeklyPattern = /^\d{4}-W\d{2}/;
  const monthlyPattern = /^\d{4}-\d{2}$/;
  const quarterlyPattern = /^\d{4}-Q[1-4]$/;
  const yearlyPattern = /^\d{4}$/;

  if (dailyPattern.test(filename)) {
    templatePath = templates.daily;
    periodicType = 'daily';
  } else if (weeklyPattern.test(filename)) {
    templatePath = templates.weekly;
    periodicType = 'weekly';
  } else if (monthlyPattern.test(filename)) {
    templatePath = templates.monthly;
    periodicType = 'monthly';
  } else if (quarterlyPattern.test(filename)) {
    templatePath = templates.quarterly;
    periodicType = 'quarterly';
  } else if (yearlyPattern.test(filename)) {
    templatePath = templates.yearly;
    periodicType = 'yearly';
  }

  // If config didn't have the template path, scan common locations as fallback
  if (!templatePath && periodicType) {
    const candidates = [
      `templates/${periodicType}.md`,
      `templates/${periodicType[0].toUpperCase() + periodicType.slice(1)}.md`,
      `templates/${periodicType}-note.md`,
      `templates/${periodicType[0].toUpperCase() + periodicType.slice(1)} Note.md`,
    ];
    for (const candidate of candidates) {
      try {
        await fs.access(path.join(vaultPath, candidate));
        templatePath = candidate;
        console.error(`[Flywheel] Template not in config but found at ${candidate} — using it`);
        break;
      } catch { /* not found, try next */ }
    }
  }

  // Read template content or use minimal fallback
  let templateContent: string;
  if (templatePath) {
    try {
      const absTemplatePath = path.join(vaultPath, templatePath);
      templateContent = await fs.readFile(absTemplatePath, 'utf-8');
    } catch {
      // Template not readable, use fallback
      console.error(`[Flywheel] Template at ${templatePath} not readable, using minimal fallback`);
      const title = path.basename(notePath, '.md');
      templateContent = `---\n---\n\n# ${title}\n`;
      templatePath = undefined;
    }
  } else {
    if (periodicType) {
      console.error(`[Flywheel] No ${periodicType} template found in config or vault — using minimal fallback`);
    }
    const title = path.basename(notePath, '.md');
    templateContent = `---\n---\n\n# ${title}\n`;
  }

  // Perform simple date substitution in templates
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  templateContent = templateContent
    .replace(/\{\{date\}\}/g, dateStr)
    .replace(/\{\{title\}\}/g, path.basename(notePath, '.md'));

  // Ensure frontmatter always contains a date field
  const matter = (await import('gray-matter')).default;
  const parsed = matter(templateContent);
  if (!parsed.data.date) {
    parsed.data.date = dateStr;
  }
  // Write via secure writeVaultFile (validates path + blocks sensitive files)
  await writeVaultFile(vaultPath, notePath, parsed.content, parsed.data as Record<string, unknown>);

  return { created: true, templateUsed: templatePath };
}

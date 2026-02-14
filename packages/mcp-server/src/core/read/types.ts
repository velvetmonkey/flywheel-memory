/**
 * Core types for Flywheel vault indexing
 */

/** A wikilink extracted from a note */
export interface OutLink {
  target: string;      // Note title or path (without .md)
  alias?: string;      // Display text from [[target|alias]]
  line: number;        // 1-indexed line number
}

/** A parsed note from the vault */
export interface VaultNote {
  path: string;                           // Relative to vault root, with .md
  title: string;                          // Filename without .md
  aliases: string[];                      // From frontmatter aliases field
  frontmatter: Record<string, unknown>;   // All frontmatter data
  outlinks: OutLink[];                    // [[wikilinks]] this note contains
  tags: string[];                         // #tags from content + frontmatter
  modified: Date;                         // File modification time
  created?: Date;                         // File creation time (if available)
}

/** Backlink info - a note that links to another note */
export interface Backlink {
  source: string;      // Path of the note containing the link
  line: number;        // Line number where the link appears
  context?: string;    // Surrounding text for context
}

/** The complete vault index */
export interface VaultIndex {
  notes: Map<string, VaultNote>;           // path -> VaultNote
  backlinks: Map<string, Backlink[]>;      // normalized target -> backlinks
  entities: Map<string, string>;           // lowercase title/alias -> path
  tags: Map<string, Set<string>>;          // tag -> note paths
  builtAt: Date;                           // When the index was built (for staleness detection)
}

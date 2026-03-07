/**
 * Markdown frontmatter parser — wraps gray-matter for typed primitive parsing.
 */

import matter from 'gray-matter';
import type { PrimitiveFrontmatter } from '../models/primitives.js';

export interface ParsedMarkdown {
  frontmatter: PrimitiveFrontmatter;
  /** Body content WITHOUT the frontmatter block */
  content: string;
  /** The full original file content */
  rawContent: string;
}

/** Parse a markdown file's YAML frontmatter and body */
export function parseMarkdown(raw: string): ParsedMarkdown {
  const parsed = matter(raw);
  return {
    frontmatter: parsed.data as PrimitiveFrontmatter,
    content: parsed.content.trim(),
    rawContent: raw,
  };
}

/** Strip frontmatter from markdown (returns body content only) */
export function stripFrontmatter(raw: string): string {
  return matter(raw).content.trim();
}

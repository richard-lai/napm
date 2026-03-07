/**
 * Link resolver — inlines relative markdown link targets into their referencing
 * document.  Handles `[text](./relative)` and `[text](../relative)` patterns
 * up to a configurable depth, with cycle detection to prevent infinite loops.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Matches markdown links whose target is a relative path:
 *   [link text](./something.md)
 *   [link text](../other/file.md)
 *
 * Capture groups:
 *   1 — link text
 *   2 — relative path
 */
const RELATIVE_LINK_RE = /\[([^\]]*)\]\((\.\.?\/[^)]+)\)/g;

// ---------------------------------------------------------------------------
// Internal recursive implementation (carries visited set across recursion)
// ---------------------------------------------------------------------------

function resolveLinks(
  content: string,
  baseDir: string,
  depth: number,
  visited: ReadonlySet<string>,
): string {
  if (depth <= 0) return content;

  return content.replace(RELATIVE_LINK_RE, (match, _text: string, linkPath: string) => {
    const absPath = path.resolve(baseDir, linkPath);

    // Cycle guard
    if (visited.has(absPath)) return match;

    // Missing file — leave the original link intact
    if (!fs.existsSync(absPath)) return match;

    let fileContent: string;
    try {
      fileContent = fs.readFileSync(absPath, 'utf-8');
    } catch {
      return match;
    }

    const newVisited = new Set(visited);
    newVisited.add(absPath);

    // Recursively resolve links inside the inlined file
    return resolveLinks(fileContent, path.dirname(absPath), depth - 1, newVisited);
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve relative markdown links in `content` by inlining the referenced
 * file's content.  Recurses up to `maxDepth` levels and uses a visited-file
 * set to prevent infinite loops from circular references.
 *
 * @param content   Source markdown text that may contain relative links.
 * @param baseDir   Directory used to resolve relative link paths.
 * @param maxDepth  Maximum recursion depth (default 3).
 */
export function resolveMarkdownLinks(content: string, baseDir: string, maxDepth = 3): string {
  return resolveLinks(content, baseDir, maxDepth, new Set<string>());
}

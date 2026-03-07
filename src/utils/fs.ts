/**
 * File system utilities — safe wrappers around Node's fs module.
 * All path operations use path.join() / path.posix for cross-platform safety.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Recursively ensure a directory exists (like mkdir -p) */
export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

/** Copy a file, creating the parent directory if needed */
export function copyFile(src: string, dest: string): void {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

/** Write text to a file, creating parent directories as needed */
export function writeText(filePath: string, content: string): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf-8');
}

/** Read text from a file; returns null if it doesn't exist */
export function readText(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf-8');
}

/** Recursively remove a directory (like rm -rf) */
export function removeDir(dirPath: string): void {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}

/** Return all files under a directory matching optional extension filter */
export function walkDir(dir: string, extFilter?: string[]): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  const recurse = (current: string) => {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        recurse(full);
      } else if (
        !extFilter ||
        extFilter.some((ext) => entry.name.toLowerCase().endsWith(ext))
      ) {
        results.push(full);
      }
    }
  };
  recurse(dir);
  return results;
}

/** Convert an absolute path to a posix-style relative path from a base */
export function toPosixRelative(base: string, filePath: string): string {
  return path.relative(base, filePath).split(path.sep).join('/');
}

/** Safely delete a file if it exists */
export function removeFile(filePath: string): boolean {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
}

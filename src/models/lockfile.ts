/**
 * LockfileDependency & ApmLockfile — schema for apm.lock
 * Format-compatible with the Python APM tool's apm.lock YAML spec.
 */

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

export interface LockfileDependency {
  repo_url: string;
  host: string;
  resolved_commit: string;
  resolved_ref: string;
  version: string;
  virtual_path?: string;
  is_virtual?: boolean;
  depth: number;
  /** Key (canonical identity) of the parent dependency that pulled this in */
  resolved_by?: string;
  /** Relative paths (posix) of every file deployed by this package */
  deployed_files?: string[];
}

export interface ApmLockfile {
  lockfile_version: '1';
  generated_at: string;
  apm_version: string;
  /** Ordered list — NOT a map — matching the Python APM format */
  dependencies: LockfileDependency[];
}

const LOCKFILE_NAME = 'apm.lock';

export function getLockfilePath(projectRoot: string): string {
  return path.join(projectRoot, LOCKFILE_NAME);
}

export function readLockfile(projectRoot: string): ApmLockfile | null {
  const lockPath = getLockfilePath(projectRoot);
  if (!fs.existsSync(lockPath)) return null;
  try {
    const raw = fs.readFileSync(lockPath, 'utf-8');
    const parsed = yaml.load(raw) as ApmLockfile;
    if (!parsed || !Array.isArray(parsed.dependencies)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeLockfile(projectRoot: string, lockfile: ApmLockfile): void {
  const lockPath = getLockfilePath(projectRoot);
  const content = yaml.dump(lockfile, { lineWidth: 120, sortKeys: false });
  fs.writeFileSync(lockPath, content, 'utf-8');
}

export function removeLockfile(projectRoot: string): void {
  const lockPath = getLockfilePath(projectRoot);
  if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
}

export function createEmptyLockfile(napmVersion: string): ApmLockfile {
  return {
    lockfile_version: '1',
    generated_at: new Date().toISOString(),
    apm_version: napmVersion,
    dependencies: [],
  };
}

/** Find a lockfile entry by its canonical key (repo_url[/virtual_path]) */
export function findLockEntry(
  lockfile: ApmLockfile,
  key: string,
): LockfileDependency | undefined {
  return lockfile.dependencies.find((d) => buildLockKey(d) === key);
}

/** Build the canonical key for a lockfile entry — matches DependencyReference.getUniqueKey() */
export function buildLockKey(dep: LockfileDependency): string {
  if (dep.is_virtual && dep.virtual_path) {
    return `${dep.repo_url}/${dep.virtual_path}`;
  }
  return dep.repo_url;
}

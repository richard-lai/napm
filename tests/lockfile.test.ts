import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';
import {
  readLockfile,
  writeLockfile,
  createEmptyLockfile,
  buildLockKey,
  findLockEntry,
  type ApmLockfile,
  type LockfileDependency,
} from '../src/models/lockfile.js';

describe('Lockfile round-trip', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'napm-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when no lockfile exists', () => {
    expect(readLockfile(tmpDir)).toBeNull();
  });

  it('writes and reads back a lockfile preserving all fields', () => {
    const dep: LockfileDependency = {
      repo_url: 'microsoft/apm-sample-package',
      host: 'github.com',
      resolved_commit: 'abc123def456abc123def456abc123def456abc1',
      resolved_ref: 'main',
      version: '1.2.3',
      depth: 1,
      deployed_files: ['.github/prompts/review.prompt.md'],
    };
    const lockfile: ApmLockfile = {
      lockfile_version: '1',
      generated_at: '2026-03-07T00:00:00.000Z',
      apm_version: '0.1.0',
      dependencies: [dep],
    };

    writeLockfile(tmpDir, lockfile);
    const read = readLockfile(tmpDir);

    expect(read).not.toBeNull();
    expect(read!.lockfile_version).toBe('1');
    expect(read!.dependencies).toHaveLength(1);
    const readDep = read!.dependencies[0]!;
    expect(readDep.repo_url).toBe('microsoft/apm-sample-package');
    expect(readDep.resolved_commit).toBe('abc123def456abc123def456abc123def456abc1');
    expect(readDep.deployed_files).toEqual(['.github/prompts/review.prompt.md']);
  });

  it('produces valid YAML parseable by js-yaml', () => {
    const lockfile = createEmptyLockfile('0.1.0');
    writeLockfile(tmpDir, lockfile);
    const raw = fs.readFileSync(path.join(tmpDir, 'apm.lock'), 'utf-8');
    expect(() => yaml.load(raw)).not.toThrow();
  });

  it('buildLockKey uses repoUrl for non-virtual deps', () => {
    const dep: LockfileDependency = {
      repo_url: 'owner/repo',
      host: 'github.com',
      resolved_commit: 'abc',
      resolved_ref: 'main',
      version: '1.0.0',
      depth: 1,
    };
    expect(buildLockKey(dep)).toBe('owner/repo');
  });

  it('buildLockKey includes virtual_path for virtual deps', () => {
    const dep: LockfileDependency = {
      repo_url: 'owner/repo',
      host: 'github.com',
      resolved_commit: 'abc',
      resolved_ref: 'main',
      version: '0.0.0',
      depth: 1,
      is_virtual: true,
      virtual_path: 'skills/frontend',
    };
    expect(buildLockKey(dep)).toBe('owner/repo/skills/frontend');
  });

  it('findLockEntry returns the correct entry', () => {
    const lockfile = createEmptyLockfile('0.1.0');
    lockfile.dependencies.push({
      repo_url: 'owner/repo',
      host: 'github.com',
      resolved_commit: 'abc',
      resolved_ref: 'main',
      version: '1.0.0',
      depth: 1,
    });
    const found = findLockEntry(lockfile, 'owner/repo');
    expect(found).toBeDefined();
    expect(found!.repo_url).toBe('owner/repo');
  });
});

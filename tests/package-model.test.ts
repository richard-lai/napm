import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readProjectManifest, writeProjectManifest, validateApmPackage, PackageType } from '../src/models/package.js';
import type { ApmManifest } from '../src/models/manifest.js';

describe('readProjectManifest / writeProjectManifest', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'napm-pkg-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when apm.yml does not exist', () => {
    expect(readProjectManifest(tmpDir)).toBeNull();
  });

  it('writes and reads back a manifest', () => {
    const manifest: ApmManifest = {
      name: 'test-project',
      version: '1.0.0',
      description: 'A test project',
      dependencies: {
        apm: ['microsoft/apm-sample-package'],
      },
    };
    writeProjectManifest(tmpDir, manifest);
    const read = readProjectManifest(tmpDir);
    expect(read).not.toBeNull();
    expect(read!.name).toBe('test-project');
    expect(read!.version).toBe('1.0.0');
    expect(read!.dependencies?.apm).toEqual(['microsoft/apm-sample-package']);
  });
});

describe('validateApmPackage', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'napm-validate-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns INVALID for an empty directory', () => {
    const result = validateApmPackage(tmpDir);
    expect(result.packageType).toBe(PackageType.INVALID);
    expect(result.package).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('returns APM_PACKAGE for a directory with valid apm.yml', () => {
    const manifest: ApmManifest = { name: 'test-pkg', version: '1.0.0' };
    writeProjectManifest(tmpDir, manifest);
    const result = validateApmPackage(tmpDir);
    expect(result.packageType).toBe(PackageType.APM_PACKAGE);
    expect(result.package).not.toBeNull();
    expect(result.errors).toHaveLength(0);
  });

  it('returns CLAUDE_SKILL for a directory with only SKILL.md', () => {
    fs.writeFileSync(path.join(tmpDir, 'SKILL.md'), '# My Skill\n', 'utf-8');
    const result = validateApmPackage(tmpDir);
    expect(result.packageType).toBe(PackageType.CLAUDE_SKILL);
  });

  it('returns HYBRID for a directory with both apm.yml and SKILL.md', () => {
    const manifest: ApmManifest = { name: 'hybrid-pkg', version: '1.0.0' };
    writeProjectManifest(tmpDir, manifest);
    fs.writeFileSync(path.join(tmpDir, 'SKILL.md'), '# Skill\n', 'utf-8');
    const result = validateApmPackage(tmpDir);
    expect(result.packageType).toBe(PackageType.HYBRID);
  });

  it('returns HOOK_PACKAGE for a directory with only hooks/*.json', () => {
    const hooksDir = path.join(tmpDir, 'hooks');
    fs.mkdirSync(hooksDir);
    fs.writeFileSync(path.join(hooksDir, 'pre-tool.json'), '{}', 'utf-8');
    const result = validateApmPackage(tmpDir);
    expect(result.packageType).toBe(PackageType.HOOK_PACKAGE);
  });
});

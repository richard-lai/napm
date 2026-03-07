/**
 * Package model — APMPackage, PackageInfo, PackageType, validateApmPackage()
 */

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import type { ApmManifest } from './manifest.js';
import type { DependencyReference } from './dependency-reference.js';

export enum PackageType {
  APM_PACKAGE = 'APM_PACKAGE',   // has apm.yml
  CLAUDE_SKILL = 'CLAUDE_SKILL', // has SKILL.md only
  HYBRID = 'HYBRID',             // has both apm.yml + SKILL.md
  HOOK_PACKAGE = 'HOOK_PACKAGE', // has hooks/*.json only
  VIRTUAL_FILE = 'VIRTUAL_FILE', // single primitive file
  INVALID = 'INVALID',
}

export interface APMPackage {
  manifest: ApmManifest;
  installPath: string;
}

export interface PackageInfo {
  package: APMPackage;
  installPath: string;
  dependencyRef: DependencyReference;
  packageType: PackageType;
}

export interface ValidationResult {
  package: APMPackage | null;
  packageType: PackageType;
  errors: string[];
}

/**
 * Inspect an install directory and determine what kind of APM package it is.
 * Returns a ValidationResult so callers can decide how to handle the package.
 */
export function validateApmPackage(installPath: string): ValidationResult {
  const errors: string[] = [];

  const hasApmYml = fs.existsSync(path.join(installPath, 'apm.yml'));
  const hasSkillMd = fs.existsSync(path.join(installPath, 'SKILL.md'));
  const hasHooks = (() => {
    const hooksDir = path.join(installPath, 'hooks');
    if (!fs.existsSync(hooksDir)) return false;
    return fs.readdirSync(hooksDir).some((f) => f.endsWith('.json'));
  })();

  let packageType: PackageType;
  if (hasApmYml && hasSkillMd) {
    packageType = PackageType.HYBRID;
  } else if (hasApmYml) {
    packageType = PackageType.APM_PACKAGE;
  } else if (hasSkillMd) {
    packageType = PackageType.CLAUDE_SKILL;
  } else if (hasHooks) {
    packageType = PackageType.HOOK_PACKAGE;
  } else {
    packageType = PackageType.INVALID;
    errors.push(`No apm.yml, SKILL.md, or hooks/ found in ${installPath}`);
    return { package: null, packageType, errors };
  }

  if (!hasApmYml) {
    // Synthesise a minimal manifest for skill/hook packages
    const name = path.basename(installPath);
    const manifest: ApmManifest = { name, version: '0.0.0' };
    return {
      package: { manifest, installPath },
      packageType,
      errors,
    };
  }

  try {
    const raw = fs.readFileSync(path.join(installPath, 'apm.yml'), 'utf-8');
    const manifest = yaml.load(raw) as ApmManifest;
    if (!manifest?.name) {
      errors.push('apm.yml is missing required field: name');
    }
    return { package: { manifest, installPath }, packageType, errors };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`Failed to parse apm.yml: ${msg}`);
    return { package: null, packageType: PackageType.INVALID, errors };
  }
}

/**
 * Read the apm.yml from projectRoot (the current project, not a dependency).
 * Returns null if not found.
 */
export function readProjectManifest(projectRoot: string): ApmManifest | null {
  const manifestPath = path.join(projectRoot, 'apm.yml');
  if (!fs.existsSync(manifestPath)) return null;
  try {
    const raw = fs.readFileSync(manifestPath, 'utf-8');
    return yaml.load(raw) as ApmManifest;
  } catch {
    return null;
  }
}

/**
 * Write an ApmManifest to apm.yml in projectRoot.
 * Uses js-yaml dump with block style to preserve readability.
 */
export function writeProjectManifest(projectRoot: string, manifest: ApmManifest): void {
  const manifestPath = path.join(projectRoot, 'apm.yml');
  const content = yaml.dump(manifest, {
    lineWidth: 120,
    sortKeys: false,
    noRefs: true,
  });
  fs.writeFileSync(manifestPath, content, 'utf-8');
}

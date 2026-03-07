/**
 * DependencyResolver — recursive APM dependency resolver.
 * Mirrors the algorithm in Python APM's APMDependencyResolver.
 *
 * Algorithm:
 *  1. Parse direct deps from project apm.yml
 *  2. Check lockfile for locked SHAs (skip if --update)
 *  3. Download each package, read its apm.yml, recurse into its deps
 *  4. Detect + skip circular references (with warning)
 *  5. Write updated apm.lock
 */

import path from 'node:path';
import fs from 'node:fs';
import pLimit from 'p-limit';
import yaml from 'js-yaml';
import { DependencyReference } from '../models/dependency-reference.js';
import { PackageDownloader } from './downloader.js';
import {
  readLockfile,
  writeLockfile,
  createEmptyLockfile,
  buildLockKey,
  findLockEntry,
  type ApmLockfile,
  type LockfileDependency,
} from '../models/lockfile.js';
import { readProjectManifest } from '../models/package.js';
import type { ApmManifest } from '../models/manifest.js';
import * as log from '../utils/console.js';

export interface ResolveOptions {
  projectRoot: string;
  /** Re-resolve all deps ignoring the lockfile */
  update?: boolean;
  dryRun?: boolean;
  /** Install only APM deps, skip MCP */
  onlyApm?: boolean;
  /** Overwrite locally-authored files on collision */
  force?: boolean;
  /** Max concurrent downloads (default: 4) */
  parallelDownloads?: number;
  verbose?: boolean;
}

export interface ResolvedPackage {
  ref: DependencyReference;
  installPath: string;
  resolvedCommit: string;
  resolvedRef: string;
  depth: number;
  /** Unique key of the parent that pulled this in (transitive only) */
  resolvedBy?: string;
  /** Populated by integrators after file deployment */
  deployedFiles: string[];
}

export interface ResolveResult {
  packages: ResolvedPackage[];
  lockfile: ApmLockfile;
}

export class DependencyResolver {
  private readonly downloader: PackageDownloader;
  private readonly projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.downloader = new PackageDownloader(path.join(projectRoot, 'apm_modules'));
  }

  // ---------------------------------------------------------------------------
  // Main entry point
  // ---------------------------------------------------------------------------

  async resolve(opts: ResolveOptions): Promise<ResolveResult> {
    const manifest = readProjectManifest(opts.projectRoot);
    if (!manifest) {
      throw new Error('No apm.yml found. Run `napm init` first.');
    }

    const existingLockfile = opts.update ? null : readLockfile(opts.projectRoot);
    const napmVersion = await this.readNapmVersion();
    const limit = pLimit(opts.parallelDownloads ?? 4);

    // Map from uniqueKey → ResolvedPackage (deduplication)
    const results = new Map<string, ResolvedPackage>();
    // Track keys currently in the resolution chain for circular detection
    const chain = new Set<string>();

    const directDeps = this.parseDependencyEntries(manifest);
    if (opts.verbose) {
      log.info(`Resolving ${directDeps.length} direct dependency(ies)…`);
    }

    await this.resolveRecursive({
      deps: directDeps,
      depth: 1,
      parentKey: undefined,
      chain,
      existingLockfile,
      update: opts.update ?? false,
      limit,
      results,
      dryRun: opts.dryRun ?? false,
      verbose: opts.verbose ?? false,
    });

    const packages = [...results.values()].sort((a, b) => a.depth - b.depth);

    // Build updated lockfile
    const lockfile: ApmLockfile = createEmptyLockfile(napmVersion);
    for (const pkg of packages) {
      const entry: LockfileDependency = {
        repo_url: pkg.ref.repoUrl,
        host: pkg.ref.host,
        resolved_commit: pkg.resolvedCommit,
        resolved_ref: pkg.resolvedRef,
        version: '0.0.0', // will be overwritten from package's apm.yml if available
        virtual_path: pkg.ref.virtualPath,
        is_virtual: pkg.ref.isVirtual || undefined,
        depth: pkg.depth,
        resolved_by: pkg.resolvedBy,
        deployed_files: pkg.deployedFiles.length > 0 ? pkg.deployedFiles : undefined,
      };
      // Enrich version from downloaded manifest
      if (!opts.dryRun) {
        const pkgManifest = this.tryReadManifest(pkg.installPath);
        if (pkgManifest?.version) entry.version = pkgManifest.version;
      }
      lockfile.dependencies.push(entry);
    }

    if (!opts.dryRun) {
      writeLockfile(opts.projectRoot, lockfile);
    }

    return { packages, lockfile };
  }

  // ---------------------------------------------------------------------------
  // Recursive resolution
  // ---------------------------------------------------------------------------

  private async resolveRecursive(ctx: {
    deps: (string | Record<string, unknown>)[];
    depth: number;
    parentKey: string | undefined;
    chain: Set<string>;
    existingLockfile: ApmLockfile | null;
    update: boolean;
    limit: ReturnType<typeof pLimit>;
    results: Map<string, ResolvedPackage>;
    dryRun: boolean;
    verbose: boolean;
  }): Promise<void> {
    const {
      deps, depth, parentKey, chain, existingLockfile, update, limit, results, dryRun, verbose,
    } = ctx;

    const tasks = deps.map((rawDep) => limit(async () => {
      let ref: DependencyReference;
      try {
        ref = typeof rawDep === 'string'
          ? DependencyReference.parse(rawDep)
          : DependencyReference.parseFromDict(rawDep);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warning(`Skipping unresolvable dependency: ${msg}`);
        return;
      }

      const key = ref.getUniqueKey();

      // Dedup — already resolved
      if (results.has(key)) return;

      // Circular detection
      if (chain.has(key)) {
        log.warning(`Circular dependency detected: ${key} — skipping`);
        return;
      }

      // Look up locked commit
      const locked = existingLockfile ? findLockEntry(existingLockfile, key) : undefined;
      const lockedCommit = (!update && locked?.resolved_commit) ? locked.resolved_commit : undefined;

      if (verbose) {
        log.dim(`  resolving ${key}${lockedCommit ? ` @ ${lockedCommit.substring(0, 7)}` : ''}`);
      }

      chain.add(key);

      let installPath: string;
      let resolvedCommit: string;
      let resolvedRef: string;

      if (dryRun) {
        installPath = this.downloader.getInstallPath(ref);
        resolvedCommit = lockedCommit ?? 'DRY_RUN';
        resolvedRef = ref.reference ?? 'HEAD';
        log.dim(`  [dry-run] would install ${key}`);
      } else {
        try {
          const result = await this.downloader.download(ref, lockedCommit);
          installPath = result.installPath;
          resolvedCommit = result.resolvedCommit;
          resolvedRef = result.resolvedRef;
          log.success(`  ${key} @ ${resolvedCommit.substring(0, 7)}`);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          log.error(`Failed to download ${key}: ${msg}`);
          chain.delete(key);
          return;
        }
      }

      const resolved: ResolvedPackage = {
        ref,
        installPath,
        resolvedCommit,
        resolvedRef,
        depth,
        resolvedBy: parentKey,
        deployedFiles: [],
      };
      results.set(key, resolved);

      // Recurse into this package's own dependencies
      if (!dryRun) {
        const childManifest = this.tryReadManifest(installPath);
        const childDeps = childManifest ? this.parseDependencyEntries(childManifest) : [];
        if (childDeps.length > 0) {
          await this.resolveRecursive({
            ...ctx,
            deps: childDeps,
            depth: depth + 1,
            parentKey: key,
          });
        }
      }

      chain.delete(key);
    }));

    await Promise.all(tasks);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private parseDependencyEntries(manifest: ApmManifest): (string | Record<string, unknown>)[] {
    return manifest.dependencies?.apm ?? [];
  }

  private tryReadManifest(installPath: string): ApmManifest | null {
    const p = path.join(installPath, 'apm.yml');
    if (!fs.existsSync(p)) return null;
    try {
      return yaml.load(fs.readFileSync(p, 'utf-8')) as ApmManifest;
    } catch {
      return null;
    }
  }

  private async readNapmVersion(): Promise<string> {
    try {
      const { createRequire } = await import('node:module');
      const require = createRequire(import.meta.url);
      const pkg = require('../../package.json') as { version: string };
      return pkg.version;
    } catch {
      return '0.1.0';
    }
  }
}

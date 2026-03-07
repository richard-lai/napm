import path from 'node:path';
import fs from 'node:fs';
import type { Command } from 'commander';
import { DependencyReference } from '../models/dependency-reference.js';
import { readProjectManifest } from '../models/package.js';
import { readLockfile, writeLockfile, removeLockfile, buildLockKey } from '../models/lockfile.js';
import { removeDir } from '../utils/fs.js';
import * as log from '../utils/console.js';

interface PruneOptions {
  dryRun?: boolean;
}

export function registerPrune(program: Command): void {
  program
    .command('prune')
    .description('Remove packages not referenced in apm.yml')
    .option('--dry-run', 'show what would be removed without deleting anything')
    .action(async (opts: PruneOptions) => {
      const projectRoot = process.cwd();

      const manifest = readProjectManifest(projectRoot);
      if (!manifest) {
        log.error('No apm.yml found. Run `napm init` first.');
        process.exit(1);
      }

      const modulesDir = path.join(projectRoot, 'apm_modules');
      if (!fs.existsSync(modulesDir)) {
        log.info('No apm_modules/ directory found. Nothing to prune.');
        return;
      }

      // Build set of expected owner/repo paths from manifest
      const expectedRepoPaths = new Set<string>();
      for (const entry of manifest.dependencies?.apm ?? []) {
        try {
          const ref =
            typeof entry === 'string'
              ? DependencyReference.parse(entry)
              : DependencyReference.parseFromDict(entry as Record<string, unknown>);
          // Normalise to the two-segment owner/repo base (virtual paths extend beyond this)
          const segments = ref.repoUrl.split('/');
          expectedRepoPaths.add(segments.slice(0, 2).join('/'));
        } catch {
          /* skip unparseable entries */
        }
      }

      // Walk apm_modules/ at 2 levels: <owner>/<repo>
      const ownerEntries = fs.readdirSync(modulesDir, { withFileTypes: true });
      const orphans: string[] = [];

      for (const ownerEntry of ownerEntries) {
        if (!ownerEntry.isDirectory()) continue;
        const ownerPath = path.join(modulesDir, ownerEntry.name);
        const repoEntries = fs.readdirSync(ownerPath, { withFileTypes: true });
        for (const repoEntry of repoEntries) {
          if (!repoEntry.isDirectory()) continue;
          const repoKey = `${ownerEntry.name}/${repoEntry.name}`;
          if (!expectedRepoPaths.has(repoKey)) {
            orphans.push(repoKey);
          }
        }
      }

      if (orphans.length === 0) {
        log.success('No orphaned packages found. Nothing to prune.');
        return;
      }

      if (opts.dryRun) {
        log.blank();
        log.info(`[dry run] Would prune ${orphans.length} orphaned package(s):`);
        for (const o of orphans) log.dim(`  ${o}`);
        return;
      }

      const lockfile = readLockfile(projectRoot);
      let deployedRemoved = 0;

      for (const orphanKey of orphans) {
        log.dim(`  pruning ${orphanKey}…`);

        // Remove deployed files recorded in lockfile for this package
        if (lockfile) {
          const entry = lockfile.dependencies.find((d) => {
            const keyBase = d.repo_url.split('/').slice(0, 2).join('/');
            return keyBase === orphanKey;
          });
          if (entry) {
            for (const relPath of entry.deployed_files ?? []) {
              const absPath = path.join(projectRoot, relPath);
              if (fs.existsSync(absPath)) {
                fs.unlinkSync(absPath);
                deployedRemoved++;
              }
            }
          }
        }

        // Remove the package directory
        const pkgDir = path.join(modulesDir, ...orphanKey.split('/'));
        if (fs.existsSync(pkgDir)) removeDir(pkgDir);
      }

      // Update or remove lockfile
      if (lockfile) {
        lockfile.dependencies = lockfile.dependencies.filter((d) => {
          const keyBase = d.repo_url.split('/').slice(0, 2).join('/');
          return !orphans.includes(keyBase);
        });
        if (lockfile.dependencies.length === 0) {
          removeLockfile(projectRoot);
        } else {
          writeLockfile(projectRoot, lockfile);
        }
      }

      log.blank();
      log.success(`Pruned ${orphans.length} orphaned package(s)`);
      if (deployedRemoved > 0) log.dim(`  ${deployedRemoved} deployed file(s) removed`);
    });
}

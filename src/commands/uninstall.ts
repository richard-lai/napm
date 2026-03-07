import path from 'node:path';
import fs from 'node:fs';
import type { Command } from 'commander';
import { DependencyReference } from '../models/dependency-reference.js';
import { readProjectManifest, writeProjectManifest } from '../models/package.js';
import {
  readLockfile,
  writeLockfile,
  removeLockfile,
  buildLockKey,
  type LockfileDependency,
} from '../models/lockfile.js';
import { removeDir } from '../utils/fs.js';
import * as log from '../utils/console.js';

interface UninstallOptions {
  dryRun?: boolean;
}

export function registerUninstall(program: Command): void {
  program
    .command('uninstall <packages...>')
    .description('Remove one or more APM dependencies')
    .option('--dry-run', 'show what would be removed without making changes')
    .action(async (packages: string[], opts: UninstallOptions) => {
      const projectRoot = process.cwd();

      const manifest = readProjectManifest(projectRoot);
      if (!manifest) {
        log.error('No apm.yml found. Nothing to uninstall.');
        process.exit(1);
      }

      // Parse requested package identifiers
      const toRemove: DependencyReference[] = [];
      for (const pkg of packages) {
        try {
          toRemove.push(DependencyReference.parse(pkg));
        } catch (err) {
          log.error(
            `Invalid package specifier "${pkg}": ${err instanceof Error ? err.message : String(err)}`,
          );
          process.exit(1);
        }
      }

      const removeIdentities = new Set(toRemove.map((r) => r.getIdentity()));

      // Match against manifest entries and split into kept / removed
      const apmDeps = manifest.dependencies?.apm ?? [];
      const kept: typeof apmDeps = [];
      const removedIdentities = new Set<string>();

      for (const entry of apmDeps) {
        let ref: DependencyReference;
        try {
          ref =
            typeof entry === 'string'
              ? DependencyReference.parse(entry)
              : DependencyReference.parseFromDict(entry as Record<string, unknown>);
        } catch {
          kept.push(entry); // can't parse → keep it untouched
          continue;
        }

        if (removeIdentities.has(ref.getIdentity())) {
          removedIdentities.add(ref.getIdentity());
          log.dim(`  removing from apm.yml: ${ref.getIdentity()}`);
        } else {
          kept.push(entry);
        }
      }

      for (const id of removeIdentities) {
        if (!removedIdentities.has(id)) {
          log.warning(`Package not found in apm.yml: ${id}`);
        }
      }

      // Collect matching lockfile entries (direct + transitive orphans)
      const lockfile = readLockfile(projectRoot);
      const toRemoveLockEntries: LockfileDependency[] = [];

      if (lockfile) {
        // Direct entries
        for (const dep of lockfile.dependencies) {
          if (removedIdentities.has(buildLockKey(dep))) {
            toRemoveLockEntries.push(dep);
          }
        }

        // Cascade: depth > 1 entries whose resolved_by points to a removed key
        const removedKeysSet = new Set(toRemoveLockEntries.map((d) => buildLockKey(d)));
        let changed = true;
        while (changed) {
          changed = false;
          for (const dep of lockfile.dependencies) {
            const key = buildLockKey(dep);
            if (
              !removedKeysSet.has(key) &&
              dep.depth > 1 &&
              dep.resolved_by != null &&
              removedKeysSet.has(dep.resolved_by)
            ) {
              removedKeysSet.add(key);
              toRemoveLockEntries.push(dep);
              changed = true;
            }
          }
        }
      }

      if (opts.dryRun) {
        log.blank();
        log.info('[dry run] Would remove:');
        for (const id of removedIdentities) log.dim(`  ${id}`);
        const transitives = toRemoveLockEntries.filter(
          (e) => !removedIdentities.has(buildLockKey(e)),
        );
        for (const e of transitives) {
          log.dim(`  ${buildLockKey(e)} (transitive orphan)`);
        }
        return;
      }

      if (removedIdentities.size === 0) {
        log.warning('No matching packages found to uninstall.');
        return;
      }

      // Update manifest on disk
      if (!manifest.dependencies) manifest.dependencies = {};
      manifest.dependencies.apm = kept;
      writeProjectManifest(projectRoot, manifest);

      // Remove deployed files and package directories
      let deployedRemoved = 0;
      let pkgDirsRemoved = 0;
      const allRemovedKeys = new Set(toRemoveLockEntries.map((e) => buildLockKey(e)));

      for (const entry of toRemoveLockEntries) {
        // Remove every file this package deployed
        for (const relPath of entry.deployed_files ?? []) {
          const absPath = path.join(projectRoot, relPath);
          if (fs.existsSync(absPath)) {
            fs.unlinkSync(absPath);
            deployedRemoved++;
          }
        }

        // Remove the package directory from apm_modules/
        const pkgDir = path.join(projectRoot, 'apm_modules', ...entry.repo_url.split('/'));
        if (fs.existsSync(pkgDir)) {
          removeDir(pkgDir);
          pkgDirsRemoved++;
        }
      }

      // Update or remove lockfile
      if (lockfile) {
        lockfile.dependencies = lockfile.dependencies.filter(
          (d) => !allRemovedKeys.has(buildLockKey(d)),
        );
        if (lockfile.dependencies.length === 0) {
          removeLockfile(projectRoot);
        } else {
          writeLockfile(projectRoot, lockfile);
        }
      }

      // Summary
      log.blank();
      log.success(`Uninstalled ${removedIdentities.size} package(s)`);
      if (deployedRemoved > 0) log.dim(`  ${deployedRemoved} deployed file(s) removed`);
      if (pkgDirsRemoved > 0) log.dim(`  ${pkgDirsRemoved} package director(ies) removed`);
      const transitiveOrphans = toRemoveLockEntries.filter(
        (e) => !removedIdentities.has(buildLockKey(e)),
      );
      if (transitiveOrphans.length > 0) {
        log.dim(`  ${transitiveOrphans.length} transitive orphan(s) also removed`);
      }
    });
}

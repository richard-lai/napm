import path from 'node:path';
import fs from 'node:fs';
import readline from 'node:readline';
import type { Command } from 'commander';
import Table from 'cli-table3';
import { DependencyReference } from '../models/dependency-reference.js';
import {
  readLockfile,
  writeLockfile,
  removeLockfile,
  buildLockKey,
  type LockfileDependency,
} from '../models/lockfile.js';
import { PackageDownloader } from '../deps/downloader.js';
import { removeDir, toPosixRelative, walkDir } from '../utils/fs.js';
import { buildIntegrators, runInstall } from './install.js';
import * as log from '../utils/console.js';

function askConfirmation(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

function countPrimitives(installPath: string): {
  prompts: number;
  instructions: number;
  agents: number;
  skills: number;
  hooks: number;
} {
  const counts = { prompts: 0, instructions: 0, agents: 0, skills: 0, hooks: 0 };
  if (!fs.existsSync(installPath)) return counts;

  const allFiles = walkDir(installPath);
  for (const f of allFiles) {
    const base = path.basename(f);
    const normalized = f.split(path.sep).join('/');
    if (base.endsWith('.prompt.md')) counts.prompts++;
    else if (base.endsWith('.instructions.md')) counts.instructions++;
    else if (base.endsWith('.agent.md') || base.endsWith('.chatmode.md')) counts.agents++;
    else if (base.endsWith('.skill.md')) counts.skills++;
    else if (base.endsWith('.json') && normalized.includes('/hooks/')) counts.hooks++;
  }
  return counts;
}

function printTree(
  allDeps: LockfileDependency[],
  parentKey: string | undefined,
  indent: number,
): void {
  const children =
    parentKey == null
      ? allDeps.filter((d) => d.depth === 1)
      : allDeps.filter((d) => d.resolved_by === parentKey);

  for (const dep of children) {
    const key = buildLockKey(dep);
    const indentStr = '  '.repeat(indent);
    const connector = indent === 0 ? '' : '└─ ';
    const commit =
      dep.resolved_commit.length >= 7
        ? dep.resolved_commit.substring(0, 7)
        : dep.resolved_commit;
    console.log(`${indentStr}${connector}${key} @ ${commit} (v${dep.version})`);
    printTree(allDeps, key, indent + 1);
  }
}

export function registerDeps(program: Command): void {
  const depsCmd = program
    .command('deps')
    .description('Inspect and manage installed dependencies')
    .action(() => {
      depsCmd.help();
    });

  // ----------------------------------------------------------------------------
  // deps list
  // ----------------------------------------------------------------------------
  depsCmd
    .command('list')
    .description('List all installed dependencies')
    .option('--json', 'output as JSON')
    .action((opts: { json?: boolean }) => {
      const projectRoot = process.cwd();
      const lockfile = readLockfile(projectRoot);

      if (!lockfile || lockfile.dependencies.length === 0) {
        log.info('No packages installed.');
        return;
      }

      if (opts.json) {
        console.log(JSON.stringify(lockfile.dependencies, null, 2));
        return;
      }

      const table = new Table({
        head: ['Package', 'Version', 'Source', 'Prompts', 'Instructions', 'Agents', 'Skills', 'Hooks'],
        style: { head: ['cyan'] },
      });

      const modulesDir = path.join(projectRoot, 'apm_modules');
      for (const dep of lockfile.dependencies) {
        const installPath = path.join(modulesDir, ...dep.repo_url.split('/'));
        const c = countPrimitives(installPath);
        const key = buildLockKey(dep);
        const label = dep.depth > 1 ? `  └ ${key}` : key;
        table.push([
          label,
          dep.version,
          dep.host,
          c.prompts > 0 ? String(c.prompts) : '-',
          c.instructions > 0 ? String(c.instructions) : '-',
          c.agents > 0 ? String(c.agents) : '-',
          c.skills > 0 ? String(c.skills) : '-',
          c.hooks > 0 ? String(c.hooks) : '-',
        ]);
      }

      console.log(table.toString());
    });

  // ----------------------------------------------------------------------------
  // deps tree
  // ----------------------------------------------------------------------------
  depsCmd
    .command('tree')
    .description('Show the full dependency tree')
    .action(() => {
      const projectRoot = process.cwd();
      const lockfile = readLockfile(projectRoot);

      if (!lockfile || lockfile.dependencies.length === 0) {
        log.info('No packages installed.');
        return;
      }

      log.header('Dependency tree:');
      log.blank();
      printTree(lockfile.dependencies, undefined, 0);
    });

  // ----------------------------------------------------------------------------
  // deps info <name>
  // ----------------------------------------------------------------------------
  depsCmd
    .command('info <name>')
    .description('Show details for a specific installed dependency')
    .action((name: string) => {
      const projectRoot = process.cwd();
      const lockfile = readLockfile(projectRoot);

      if (!lockfile || lockfile.dependencies.length === 0) {
        log.info('No packages installed.');
        return;
      }

      const match = lockfile.dependencies.find((d) =>
        buildLockKey(d).toLowerCase().includes(name.toLowerCase()),
      );

      if (!match) {
        log.error(`Package not found: ${name}`);
        process.exit(1);
      }

      const key = buildLockKey(match);
      const installPath = path.join(projectRoot, 'apm_modules', ...match.repo_url.split('/'));
      const c = countPrimitives(installPath);

      log.blank();
      log.header(key);
      log.kv('Version', match.version);
      log.kv('Commit', match.resolved_commit);
      log.kv('Ref', match.resolved_ref);
      log.kv('Source', `${match.host}/${match.repo_url}`);
      log.kv('Depth', String(match.depth));
      if (match.resolved_by) log.kv('Resolved by', match.resolved_by);
      log.kv('Install path', installPath);
      log.blank();
      log.header('Primitives:');
      log.kv('Prompts', String(c.prompts), 2);
      log.kv('Instructions', String(c.instructions), 2);
      log.kv('Agents', String(c.agents), 2);
      log.kv('Skills', String(c.skills), 2);
      log.kv('Hooks', String(c.hooks), 2);
      if (match.deployed_files && match.deployed_files.length > 0) {
        log.blank();
        log.header('Deployed files:');
        for (const f of match.deployed_files) log.dim(`  ${f}`);
      }
    });

  // ----------------------------------------------------------------------------
  // deps clean
  // ----------------------------------------------------------------------------
  depsCmd
    .command('clean')
    .description('Remove all installed packages from apm_modules/')
    .option('--yes', 'skip confirmation prompt')
    .action(async (opts: { yes?: boolean }) => {
      const projectRoot = process.cwd();

      if (!opts.yes) {
        const confirmed = await askConfirmation(
          'This will remove all installed packages and the lockfile. Continue? (y/N) ',
        );
        if (!confirmed) {
          log.info('Cancelled.');
          return;
        }
      }

      const modulesDir = path.join(projectRoot, 'apm_modules');
      let packageCount = 0;

      if (fs.existsSync(modulesDir)) {
        const owners = fs
          .readdirSync(modulesDir, { withFileTypes: true })
          .filter((e) => e.isDirectory());
        for (const owner of owners) {
          const repos = fs
            .readdirSync(path.join(modulesDir, owner.name), { withFileTypes: true })
            .filter((e) => e.isDirectory());
          packageCount += repos.length;
        }
        removeDir(modulesDir);
      }

      removeLockfile(projectRoot);

      log.blank();
      log.success(`Removed ${packageCount} package(s) from apm_modules/`);
      log.dim('  apm.lock removed');
    });

  // ----------------------------------------------------------------------------
  // deps update [name]
  // ----------------------------------------------------------------------------
  depsCmd
    .command('update [name]')
    .description('Update one or all dependencies to their latest versions')
    .action(async (name: string | undefined) => {
      const projectRoot = process.cwd();

      if (!name) {
        // Full update — re-resolve everything from scratch
        await runInstall([], { update: true }, projectRoot);
        return;
      }

      // Targeted update: re-download a specific package
      const lockfile = readLockfile(projectRoot);
      if (!lockfile || lockfile.dependencies.length === 0) {
        log.error('No packages installed. Run `napm install` first.');
        process.exit(1);
        return;
      }

      // Find the entry in the lockfile (exact or partial match)
      const existingEntry = lockfile.dependencies.find(
        (d) =>
          buildLockKey(d) === name ||
          buildLockKey(d).toLowerCase().includes(name.toLowerCase()),
      );

      if (!existingEntry) {
        log.error(
          `Package "${name}" is not installed. Run \`napm install ${name}\` first.`,
        );
        process.exit(1);
        return;
      }

      const key = buildLockKey(existingEntry);
      log.info(`Updating ${key}…`);

      // Reconstruct a DependencyReference from lockfile data
      const refStr =
        existingEntry.host === 'github.com'
          ? existingEntry.repo_url
          : `${existingEntry.host}/${existingEntry.repo_url}`;
      let exactRef: DependencyReference;
      try {
        exactRef = DependencyReference.parse(refStr);
      } catch (err) {
        log.error(
          `Cannot reconstruct reference for "${key}": ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
        return;
      }

      // Re-download (no lockedCommit = force fresh)
      const downloader = new PackageDownloader(path.join(projectRoot, 'apm_modules'));
      let installPath: string;
      let resolvedCommit: string;
      let resolvedRef: string;
      try {
        const dlResult = await downloader.download(exactRef);
        installPath = dlResult.installPath;
        resolvedCommit = dlResult.resolvedCommit;
        resolvedRef = dlResult.resolvedRef;
      } catch (err) {
        log.error(
          `Download failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
        return;
      }

      // Re-run integrators with force=true (update implies overwrite)
      const integrators = buildIntegrators();
      const deployed: string[] = [];
      for (const integrator of integrators) {
        if (integrator.shouldIntegrate(projectRoot)) {
          const ir = integrator.integrate({ installPath, projectRoot, force: true });
          for (const absPath of ir.targetPaths) {
            deployed.push(toPosixRelative(projectRoot, absPath));
          }
        }
      }

      // Update the lockfile entry
      const entryIdx = lockfile.dependencies.findIndex(
        (d) => buildLockKey(d) === key,
      );
      if (entryIdx >= 0) {
        const entry = lockfile.dependencies[entryIdx]!;
        entry.resolved_commit = resolvedCommit;
        entry.resolved_ref = resolvedRef;
        entry.deployed_files = deployed.length > 0 ? deployed : undefined;
        writeLockfile(projectRoot, lockfile);
      }

      log.blank();
      log.success(`Updated ${key} to ${resolvedCommit.substring(0, 7)}`);
      if (deployed.length > 0) log.dim(`  ${deployed.length} file(s) deployed`);
    });
}

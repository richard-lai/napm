import path from 'node:path';
import fs from 'node:fs';
import type { Command } from 'commander';
import ora from 'ora';
import { DependencyResolver, type ResolveResult } from '../deps/resolver.js';
import { DependencyReference } from '../models/dependency-reference.js';
import { readProjectManifest, writeProjectManifest } from '../models/package.js';
import { createMinimalManifest } from '../models/manifest.js';
import { writeLockfile, buildLockKey } from '../models/lockfile.js';
import { PromptIntegrator } from '../integration/prompt-integrator.js';
import { AgentIntegrator } from '../integration/agent-integrator.js';
import { InstructionIntegrator } from '../integration/instruction-integrator.js';
import { SkillIntegrator } from '../integration/skill-integrator.js';
import { HookIntegrator } from '../integration/hook-integrator.js';
import { CommandIntegrator } from '../integration/command-integrator.js';
import type { BaseIntegrator, IntegrationContext } from '../integration/base-integrator.js';
import { toPosixRelative, ensureDir } from '../utils/fs.js';
import * as log from '../utils/console.js';

export interface InstallOptions {
  only?: string;
  update?: boolean;
  dryRun?: boolean;
  force?: boolean;
  verbose?: boolean;
  parallelDownloads?: string;
  runtime?: string;
  exclude?: string;
}

/** Create all integrator instances. Each handles its own shouldIntegrate() check at runtime. */
export function buildIntegrators(): BaseIntegrator[] {
  return [
    new PromptIntegrator(),
    new AgentIntegrator(),
    new InstructionIntegrator(),
    new SkillIntegrator(),
    new HookIntegrator(),
    new CommandIntegrator(),
  ];
}

export function registerInstall(program: Command): void {
  program
    .command('install [packages...]')
    .description('Install APM dependencies declared in apm.yml')
    .option('--only <kind>', 'install only "apm" or "mcp" packages')
    .option('--update', 'ignore lockfile and fetch latest versions')
    .option('--dry-run', 'show what would be installed without writing anything')
    .option('--force', 'overwrite existing files without prompting')
    .option('--verbose', 'show detailed output')
    .option('--parallel-downloads <n>', 'number of concurrent downloads', '4')
    .option('--runtime <name>', 'target runtime context')
    .option('--exclude <name>', 'comma-separated package identities to exclude')
    .action(async (packages: string[], opts: InstallOptions) => {
      await runInstall(packages, opts, process.cwd());
    });
}

export async function runInstall(
  packages: string[],
  opts: InstallOptions,
  projectRoot: string,
): Promise<void> {
  // 1. Parse and validate input package specs
  const newRefs: DependencyReference[] = [];
  for (const pkg of packages) {
    try {
      newRefs.push(DependencyReference.parse(pkg));
    } catch (err) {
      log.error(
        `Invalid package specifier "${pkg}": ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  }

  // 2. Load or create manifest (in memory)
  let manifest = readProjectManifest(projectRoot);
  let needsNewManifest = false;
  if (!manifest) {
    if (newRefs.length === 0) {
      log.error('No apm.yml found. Run `napm init` first or specify a package.');
      process.exit(1);
    }
    manifest = createMinimalManifest(path.basename(projectRoot));
    needsNewManifest = true;
  }

  // 3. Merge new packages into manifest (in memory, de-duplicating by identity)
  const addedRefs: DependencyReference[] = [];
  if (newRefs.length > 0) {
    if (!manifest.dependencies) manifest.dependencies = {};
    if (!manifest.dependencies.apm) manifest.dependencies.apm = [];

    const existingIdentities = new Set<string>();
    for (const entry of manifest.dependencies.apm) {
      try {
        const ref =
          typeof entry === 'string'
            ? DependencyReference.parse(entry)
            : DependencyReference.parseFromDict(entry as Record<string, unknown>);
        existingIdentities.add(ref.getIdentity());
      } catch {
        /* skip unparseable entries */
      }
    }

    for (const ref of newRefs) {
      if (!existingIdentities.has(ref.getIdentity())) {
        manifest.dependencies.apm.push(ref.toString());
        addedRefs.push(ref);
      }
    }
  }

  // 4. Dry-run early exit — nothing hits disk
  if (opts.dryRun) {
    log.blank();
    log.info('[dry run] No files written.');
    if (needsNewManifest) log.dim('  would create apm.yml');
    for (const ref of addedRefs) log.dim(`  would add ${ref.getIdentity()} to apm.yml`);
    const apmDeps = manifest.dependencies?.apm ?? [];
    log.dim(`  would resolve and install ${apmDeps.length} package(s)`);
    return;
  }

  // 5. Write manifest to disk
  if (needsNewManifest) {
    writeProjectManifest(projectRoot, manifest);
    log.info('Created apm.yml');
  } else if (addedRefs.length > 0) {
    writeProjectManifest(projectRoot, manifest);
    for (const ref of addedRefs) {
      log.info(`Added ${ref.getIdentity()} to apm.yml`);
    }
  }

  // 6. Resolve & download all dependencies
  const spinner = ora('Resolving dependencies…').start();
  let result: ResolveResult;
  try {
    const resolver = new DependencyResolver(projectRoot);
    const parallelDownloads = parseInt(opts.parallelDownloads ?? '4', 10);
    result = await resolver.resolve({
      projectRoot,
      update: opts.update,
      dryRun: false,
      onlyApm: opts.only === 'apm',
      force: opts.force,
      parallelDownloads: Number.isNaN(parallelDownloads) ? 4 : parallelDownloads,
      verbose: opts.verbose,
    });
  } catch (err: unknown) {
    spinner.fail('Dependency resolution failed');
    log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
    return;
  }

  spinner.succeed(`Resolved ${result.packages.length} package(s)`);

  // 7. Ensure .github/ exists if neither .github/ nor .claude/ exists
  const githubDir = path.join(projectRoot, '.github');
  const claudeDir = path.join(projectRoot, '.claude');
  if (!fs.existsSync(githubDir) && !fs.existsSync(claudeDir)) {
    ensureDir(githubDir);
    log.dim('  created .github/');
  }

  // 8. Run integrators per package and collect deployed files
  const integrators = buildIntegrators();
  const excludeSet = new Set(
    (opts.exclude ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

  const totals: Record<string, number> = {};
  let totalPackages = 0;
  let totalSkipped = 0;

  for (const pkg of result.packages) {
    const identity = pkg.ref.getIdentity();

    if (excludeSet.size > 0 && [...excludeSet].some((ex) => identity.includes(ex))) {
      log.dim(`  skipping (excluded): ${identity}`);
      totalSkipped++;
      continue;
    }

    log.dim(`  installing ${identity}…`);

    const ctx: IntegrationContext = {
      installPath: pkg.installPath,
      projectRoot,
      force: opts.force,
    };

    const pkgDeployed: string[] = [];
    for (const integrator of integrators) {
      if (integrator.shouldIntegrate(projectRoot)) {
        const intResult = integrator.integrate(ctx);
        for (const absPath of intResult.targetPaths) {
          pkgDeployed.push(toPosixRelative(projectRoot, absPath));
        }
        totals[integrator.name] = (totals[integrator.name] ?? 0) + intResult.filesIntegrated;
      }
    }

    // 9. Update deployed_files in the lockfile entry for this package
    const lockEntry = result.lockfile.dependencies.find(
      (d) => buildLockKey(d) === pkg.ref.getUniqueKey(),
    );
    if (lockEntry) {
      lockEntry.deployed_files = pkgDeployed.length > 0 ? pkgDeployed : undefined;
    }

    totalPackages++;
  }

  // Persist lockfile with deployed_files populated
  writeLockfile(projectRoot, result.lockfile);

  // 10. Summary
  log.blank();
  log.header('Installation complete');
  const skipNote = totalSkipped > 0 ? `, ${totalSkipped} skipped` : '';
  log.success(`${totalPackages} package(s) installed${skipNote}`);
  for (const [type, count] of Object.entries(totals)) {
    if (count > 0) log.dim(`  ${count} ${type}`);
  }
}

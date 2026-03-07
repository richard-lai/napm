/**
 * napm compile — compile AGENTS.md and/or CLAUDE.md from installed primitives.
 */

import type { Command } from 'commander';
import { AgentsCompiler, type CompilationTarget, type CompilationStrategy } from '../compilation/agents-compiler.js';
import * as log from '../utils/console.js';

export function registerCompile(program: Command): void {
  program
    .command('compile')
    .description('Compile AGENTS.md / CLAUDE.md from installed primitives')
    .option('--target <target>', 'Compilation target: vscode, claude, or all (auto-detected if omitted)')
    .option('--strategy <strategy>', 'Compilation strategy: distributed (default) or single-file', 'distributed')
    .option('--dry-run', 'Preview what would be written without writing any files')
    .option('--local-only', 'Only use primitives from the project .apm/ directory, ignore apm_modules/')
    .option('--no-resolve-links', 'Disable inlining of referenced markdown files')
    .action(async (opts: {
      target?: string;
      strategy: string;
      dryRun?: boolean;
      localOnly?: boolean;
      resolveLinks?: boolean;
    }) => {
      const projectRoot = process.cwd();
      const target = opts.target as CompilationTarget | undefined;
      const strategy = opts.strategy as CompilationStrategy;

      if (target && !['vscode', 'claude', 'all'].includes(target)) {
        log.error(`Invalid --target "${target}". Valid values: vscode, claude, all`);
        process.exit(1);
      }
      if (!['distributed', 'single-file'].includes(strategy)) {
        log.error(`Invalid --strategy "${strategy}". Valid values: distributed, single-file`);
        process.exit(1);
      }

      if (opts.dryRun) log.info('Dry run — no files will be written');

      const compiler = new AgentsCompiler();
      try {
        const result = await compiler.compile({
          projectRoot,
          target,
          strategy,
          dryRun: opts.dryRun,
          localOnly: opts.localOnly,
          resolveLinks: opts.resolveLinks ?? true,
        });

        if (opts.dryRun) {
          if (result.filesWritten.length > 0) {
            log.info(`Would write ${result.filesWritten.length} file(s):`);
            for (const f of result.filesWritten) log.dim(`  ${f}`);
          } else {
            log.info('No files would be written.');
          }
        } else {
          log.success(`Compiled ${result.totalInstructions} instruction(s) into ${result.filesWritten.length} file(s)`);
          for (const f of result.filesWritten) log.dim(`  wrote: ${f}`);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error(`Compilation failed: ${msg}`);
        process.exit(1);
      }
    });
}

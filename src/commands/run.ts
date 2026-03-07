// src/commands/run.ts
import { spawn } from 'node:child_process';
import type { Command } from 'commander';
import { readProjectManifest } from '../models/package.js';
import * as log from '../utils/console.js';

export function registerRun(program: Command): void {
  program
    .command('run <script>')
    .description('Run a script defined in apm.yml')
    .action((scriptName: string) => {
      const manifest = readProjectManifest(process.cwd());
      if (!manifest) {
        log.error('No apm.yml found in the current directory. Run `napm init` to create one.');
        process.exit(1);
      }

      const scripts = manifest.scripts ?? {};
      const command = scripts[scriptName];

      if (command === undefined) {
        log.error(`Script "${scriptName}" not found.`);
        const available = Object.keys(scripts);
        if (available.length > 0) {
          log.info(`Available scripts: ${available.join(', ')}`);
        } else {
          log.info('No scripts are defined in apm.yml.');
        }
        process.exit(1);
      }

      log.dim(`$ ${command}`);

      const child = spawn(command, { shell: true, stdio: 'inherit' });

      child.on('close', (code) => {
        process.exit(code ?? 0);
      });

      child.on('error', (err) => {
        log.error(`Failed to start script: ${err.message}`);
        process.exit(1);
      });
    });
}

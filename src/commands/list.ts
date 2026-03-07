// src/commands/list.ts
import type { Command } from 'commander';
import { readProjectManifest } from '../models/package.js';
import * as log from '../utils/console.js';
import Table from 'cli-table3';

export function registerList(program: Command): void {
  program
    .command('list')
    .description('List scripts defined in apm.yml')
    .action(() => {
      const manifest = readProjectManifest(process.cwd());
      if (!manifest) {
        log.error('No apm.yml found in the current directory. Run `napm init` to create one.');
        process.exit(1);
      }

      const scripts = manifest.scripts;
      if (!scripts || Object.keys(scripts).length === 0) {
        log.info('No scripts defined in apm.yml.');
        log.dim('Add a "scripts" section to apm.yml to define runnable commands.');
        return;
      }

      const table = new Table({
        head: ['Script', 'Command'],
        style: { head: ['cyan'] },
      });

      for (const [scriptName, command] of Object.entries(scripts)) {
        table.push([scriptName, command]);
      }

      console.log(table.toString());
    });
}

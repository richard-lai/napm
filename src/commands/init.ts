// src/commands/init.ts
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import type { Command } from 'commander';
import inquirer from 'inquirer';
import { writeProjectManifest } from '../models/package.js';
import { createMinimalManifest } from '../models/manifest.js';
import * as log from '../utils/console.js';

function detectGitAuthor(): string {
  try {
    return execSync('git config user.name', { encoding: 'utf-8' }).trim();
  } catch {
    return '';
  }
}

export function registerInit(program: Command): void {
  program
    .command('init [name]')
    .description('Initialize a new apm.yml in the current (or a new) directory')
    .option('-y, --yes', 'use defaults without prompting')
    .action(async (name: string | undefined, opts: { yes?: boolean }) => {
      // Determine working directory
      let workDir = process.cwd();
      if (name) {
        workDir = path.resolve(workDir, name);
        if (!fs.existsSync(workDir)) {
          fs.mkdirSync(workDir, { recursive: true });
          log.info(`Created directory: ${workDir}`);
        }
      }

      const manifestPath = path.join(workDir, 'apm.yml');
      const exists = fs.existsSync(manifestPath);

      if (exists && opts.yes) {
        log.warning('apm.yml already exists — skipping (--yes mode).');
        return;
      }

      if (exists && !opts.yes) {
        const { overwrite } = await inquirer.prompt<{ overwrite: boolean }>([
          {
            type: 'confirm',
            name: 'overwrite',
            message: 'apm.yml already exists. Overwrite?',
            default: false,
          },
        ]);
        if (!overwrite) {
          log.info('Aborted.');
          return;
        }
      }

      const detectedName = name ?? path.basename(workDir);
      const detectedAuthor = detectGitAuthor();

      let projectName = detectedName;
      let version = '1.0.0';
      let description = '';
      let author = detectedAuthor;

      if (!opts.yes) {
        const answers = await inquirer.prompt<{
          name: string;
          version: string;
          description: string;
          author: string;
        }>([
          { type: 'input', name: 'name', message: 'Package name:', default: detectedName },
          { type: 'input', name: 'version', message: 'Version:', default: '1.0.0' },
          { type: 'input', name: 'description', message: 'Description:', default: '' },
          { type: 'input', name: 'author', message: 'Author:', default: detectedAuthor },
        ]);
        projectName = answers.name;
        version = answers.version;
        description = answers.description;
        author = answers.author;
      }

      const manifest = createMinimalManifest(projectName, version, description, author);
      writeProjectManifest(workDir, manifest);

      log.success(`Created apm.yml in ${workDir}`);
    });
}

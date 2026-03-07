import path from 'node:path';
import fs from 'node:fs';
import { BaseIntegrator, type IntegrationContext, type IntegrationResult } from './base-integrator.js';
import { walkDir } from '../utils/fs.js';
import * as log from '../utils/console.js';

export class PromptIntegrator extends BaseIntegrator {
  readonly name = 'prompts';

  shouldIntegrate(projectRoot: string): boolean {
    return fs.existsSync(path.join(projectRoot, '.github'));
  }

  integrate(ctx: IntegrationContext): IntegrationResult {
    const { installPath, projectRoot, force = false } = ctx;
    const result: IntegrationResult = {
      filesIntegrated: 0,
      filesRemoved: 0,
      filesSkipped: 0,
      targetPaths: [],
    };
    const destDir = path.join(projectRoot, '.github', 'prompts');

    // Scan .apm/prompts/ and root level for .prompt.md files
    const searchDirs = [
      path.join(installPath, '.apm', 'prompts'),
      installPath,
    ];

    for (const searchDir of searchDirs) {
      if (!fs.existsSync(searchDir)) continue;
      const files = walkDir(searchDir, ['.prompt.md']);
      for (const srcFile of files) {
        // Skip files in subdirectories when scanning root directly
        if (searchDir === installPath && path.dirname(srcFile) !== installPath) continue;
        const destFile = path.join(destDir, path.basename(srcFile));
        const content = fs.readFileSync(srcFile, 'utf-8');
        const status = this.writeWithCollisionCheck(destFile, content, force);
        if (status === 'written') {
          result.filesIntegrated++;
          result.targetPaths.push(destFile);
          log.dim(`    prompt: ${path.basename(srcFile)} → .github/prompts/`);
        } else {
          result.filesSkipped++;
          log.warning(`    collision: ${path.basename(srcFile)} (use --force to overwrite)`);
        }
      }
    }

    return result;
  }
}

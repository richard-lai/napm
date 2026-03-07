import path from 'node:path';
import fs from 'node:fs';
import { BaseIntegrator, type IntegrationContext, type IntegrationResult } from './base-integrator.js';
import { walkDir } from '../utils/fs.js';
import * as log from '../utils/console.js';

export class InstructionIntegrator extends BaseIntegrator {
  readonly name = 'instructions';

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

    const srcDir = path.join(installPath, '.apm', 'instructions');
    if (!fs.existsSync(srcDir)) return result;

    const destDir = path.join(projectRoot, '.github', 'instructions');
    const files = walkDir(srcDir, ['.instructions.md']);

    for (const srcFile of files) {
      const destFile = path.join(destDir, path.basename(srcFile));
      const content = fs.readFileSync(srcFile, 'utf-8');
      const status = this.writeWithCollisionCheck(destFile, content, force);
      if (status === 'written') {
        result.filesIntegrated++;
        result.targetPaths.push(destFile);
        log.dim(`    instruction: ${path.basename(srcFile)} → .github/instructions/`);
      } else {
        result.filesSkipped++;
        log.warning(`    collision: ${path.basename(srcFile)} (use --force to overwrite)`);
      }
    }

    return result;
  }
}

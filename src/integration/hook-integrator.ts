import path from 'node:path';
import fs from 'node:fs';
import { BaseIntegrator, type IntegrationContext, type IntegrationResult } from './base-integrator.js';
import { walkDir } from '../utils/fs.js';
import * as log from '../utils/console.js';

export class HookIntegrator extends BaseIntegrator {
  readonly name = 'hooks';

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

    // Search in both hooks/ and apmRoot/hooks/ (support both layouts)
    const apmRoot = ctx.primitiveRoot ?? path.join(installPath, '.apm');
    const searchDirs = [
      path.join(installPath, 'hooks'),
      path.join(apmRoot, 'hooks'),
    ];
    const destDir = path.join(projectRoot, '.github', 'hooks');

    for (const srcDir of searchDirs) {
      if (!fs.existsSync(srcDir)) continue;
      const files = walkDir(srcDir, ['.json']);
      for (const srcFile of files) {
        const destFile = path.join(destDir, path.basename(srcFile));
        const content = fs.readFileSync(srcFile, 'utf-8');
        const status = this.writeWithCollisionCheck(destFile, content, force);
        if (status === 'written') {
          result.filesIntegrated++;
          result.targetPaths.push(destFile);
          log.dim(`    hook: ${path.basename(srcFile)} → .github/hooks/`);
        } else {
          result.filesSkipped++;
          log.warning(`    collision: ${path.basename(srcFile)} (use --force to overwrite)`);
        }
      }
    }

    return result;
  }
}

import path from 'node:path';
import fs from 'node:fs';
import { BaseIntegrator, type IntegrationContext, type IntegrationResult } from './base-integrator.js';
import { walkDir, toPosixRelative } from '../utils/fs.js';
import * as log from '../utils/console.js';

export class SkillIntegrator extends BaseIntegrator {
  readonly name = 'skills';

  shouldIntegrate(projectRoot: string): boolean {
    return (
      fs.existsSync(path.join(projectRoot, '.github')) ||
      fs.existsSync(path.join(projectRoot, '.claude'))
    );
  }

  integrate(ctx: IntegrationContext): IntegrationResult {
    const { installPath, projectRoot, force = false } = ctx;
    const result: IntegrationResult = {
      filesIntegrated: 0,
      filesRemoved: 0,
      filesSkipped: 0,
      targetPaths: [],
    };

    const skillsRoot = path.join(installPath, '.apm', 'skills');
    if (!fs.existsSync(skillsRoot)) return result;

    const hasGithub = fs.existsSync(path.join(projectRoot, '.github'));
    const hasClaude = fs.existsSync(path.join(projectRoot, '.claude'));

    // Each direct subdirectory of .apm/skills/ is a skill package
    const entries = fs.readdirSync(skillsRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillName = entry.name;
      const skillSrcDir = path.join(skillsRoot, skillName);
      const skillFiles = walkDir(skillSrcDir);

      const destRoots: string[] = [];
      if (hasGithub) destRoots.push(path.join(projectRoot, '.github', 'skills', skillName));
      if (hasClaude) destRoots.push(path.join(projectRoot, '.claude', 'skills', skillName));

      for (const destRootDir of destRoots) {
        const targetLabel = toPosixRelative(projectRoot, destRootDir);
        for (const srcFile of skillFiles) {
          const relFile = path.relative(skillSrcDir, srcFile);
          const destFile = path.join(destRootDir, relFile);
          const status = this.copyWithCollisionCheck(srcFile, destFile, force);
          if (status === 'written') {
            result.filesIntegrated++;
            result.targetPaths.push(destFile);
            log.dim(`    skill: ${skillName}/${relFile} → ${targetLabel}/`);
          } else {
            result.filesSkipped++;
            log.warning(`    collision: ${skillName}/${relFile} (use --force to overwrite)`);
          }
        }
      }
    }

    return result;
  }
}

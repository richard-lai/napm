import path from 'node:path';
import fs from 'node:fs';
import { BaseIntegrator, type IntegrationContext, type IntegrationResult } from './base-integrator.js';
import { walkDir } from '../utils/fs.js';
import * as log from '../utils/console.js';

export class AgentIntegrator extends BaseIntegrator {
  readonly name = 'agents';

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

    const srcDir = path.join(installPath, '.apm', 'agents');
    if (!fs.existsSync(srcDir)) return result;

    const hasGithub = fs.existsSync(path.join(projectRoot, '.github'));
    const hasClaude = fs.existsSync(path.join(projectRoot, '.claude'));

    const files = walkDir(srcDir, ['.agent.md', '.chatmode.md']);

    for (const srcFile of files) {
      const srcBasename = path.basename(srcFile);
      // Normalize legacy format: foo.chatmode.md → foo.agent.md
      const destBasename = srcBasename.endsWith('.chatmode.md')
        ? srcBasename.replace(/\.chatmode\.md$/, '.agent.md')
        : srcBasename;

      const content = fs.readFileSync(srcFile, 'utf-8');

      if (hasGithub) {
        const destFile = path.join(projectRoot, '.github', 'agents', destBasename);
        const status = this.writeWithCollisionCheck(destFile, content, force);
        if (status === 'written') {
          result.filesIntegrated++;
          result.targetPaths.push(destFile);
          log.dim(`    agent (github): ${srcBasename} → .github/agents/${destBasename}`);
        } else {
          result.filesSkipped++;
          log.warning(`    collision: .github/agents/${destBasename} (use --force to overwrite)`);
        }
      }

      if (hasClaude) {
        const destFile = path.join(projectRoot, '.claude', 'agents', destBasename);
        const status = this.writeWithCollisionCheck(destFile, content, force);
        if (status === 'written') {
          result.filesIntegrated++;
          result.targetPaths.push(destFile);
          log.dim(`    agent (claude): ${srcBasename} → .claude/agents/${destBasename}`);
        } else {
          result.filesSkipped++;
          log.warning(`    collision: .claude/agents/${destBasename} (use --force to overwrite)`);
        }
      }
    }

    return result;
  }
}

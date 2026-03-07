import path from 'node:path';
import fs from 'node:fs';
import { BaseIntegrator, type IntegrationContext, type IntegrationResult } from './base-integrator.js';
import { walkDir } from '../utils/fs.js';
import * as log from '../utils/console.js';

/** Strip YAML frontmatter block (--- ... ---) from markdown content */
function stripFrontmatter(content: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(content);
  if (!match) return content;
  return content.slice(match[0].length).trimStart();
}

export class CommandIntegrator extends BaseIntegrator {
  readonly name = 'commands';

  /** Only integrates if the project has a .claude/ directory */
  shouldIntegrate(projectRoot: string): boolean {
    return fs.existsSync(path.join(projectRoot, '.claude'));
  }

  integrate(ctx: IntegrationContext): IntegrationResult {
    const { installPath, projectRoot, force = false } = ctx;
    const result: IntegrationResult = {
      filesIntegrated: 0,
      filesRemoved: 0,
      filesSkipped: 0,
      targetPaths: [],
    };

    const destDir = path.join(projectRoot, '.claude', 'commands');

    // Same source search as PromptIntegrator: .apm/prompts/ and root-level .prompt.md
    const searchDirs = [
      path.join(installPath, '.apm', 'prompts'),
      installPath,
    ];

    for (const srcDir of searchDirs) {
      if (!fs.existsSync(srcDir)) continue;
      const files = walkDir(srcDir, ['.prompt.md']);
      for (const srcFile of files) {
        // Only pick up root-level files when scanning installPath directly
        if (srcDir === installPath && path.dirname(srcFile) !== installPath) continue;

        const srcBasename = path.basename(srcFile);
        // foo.prompt.md → foo.md
        const destBasename = srcBasename.replace(/\.prompt\.md$/, '.md');
        const destFile = path.join(destDir, destBasename);

        const rawContent = fs.readFileSync(srcFile, 'utf-8');
        const content = stripFrontmatter(rawContent);

        const status = this.writeWithCollisionCheck(destFile, content, force);
        if (status === 'written') {
          result.filesIntegrated++;
          result.targetPaths.push(destFile);
          log.dim(`    command: ${srcBasename} → .claude/commands/${destBasename}`);
        } else {
          result.filesSkipped++;
          log.warning(`    collision: .claude/commands/${destBasename} (use --force to overwrite)`);
        }
      }
    }

    return result;
  }
}

import fs from 'node:fs';
import path from 'node:path';

export interface IntegrationResult {
  filesIntegrated: number;
  filesRemoved: number;
  filesSkipped: number;
  /** Absolute paths of newly written files */
  targetPaths: string[];
}

export interface IntegrationContext {
  installPath: string;
  projectRoot: string;
  force?: boolean;
  /** Set of posix-relative paths already deployed (from lockfile) — used for sync/cleanup */
  managedFiles?: Set<string>;
}

export abstract class BaseIntegrator {
  abstract readonly name: string;

  /** Return true if the project has the required target directory */
  abstract shouldIntegrate(projectRoot: string): boolean;

  /** Deploy all relevant primitives from installPath to projectRoot */
  abstract integrate(ctx: IntegrationContext): IntegrationResult;

  /** Remove all deployed files that belong to this package (from managedFiles set) */
  syncRemove(projectRoot: string, managedFiles: Set<string>): number {
    let removed = 0;
    for (const relPath of managedFiles) {
      const absPath = path.join(projectRoot, relPath);
      if (fs.existsSync(absPath)) {
        fs.unlinkSync(absPath);
        removed++;
      }
    }
    return removed;
  }

  protected writeWithCollisionCheck(
    destPath: string,
    content: string,
    force: boolean,
  ): 'written' | 'skipped' {
    if (fs.existsSync(destPath)) {
      const existing = fs.readFileSync(destPath, 'utf-8');
      if (existing === content) return 'written'; // already up to date
      if (!force) return 'skipped'; // different content, --force not set
    }
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(destPath, content, 'utf-8');
    return 'written';
  }

  protected copyWithCollisionCheck(
    srcPath: string,
    destPath: string,
    force: boolean,
  ): 'written' | 'skipped' {
    if (fs.existsSync(destPath)) {
      const srcContent = fs.readFileSync(srcPath, 'utf-8');
      const destContent = fs.readFileSync(destPath, 'utf-8');
      if (srcContent === destContent) return 'written';
      if (!force) return 'skipped';
    }
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(srcPath, destPath);
    return 'written';
  }

  /** Partition a flat set of managed relative paths into buckets by type */
  static partitionManagedFiles(managedFiles: Set<string>): Record<string, Set<string>> {
    const buckets: Record<string, Set<string>> = {
      prompts: new Set(),
      agents_github: new Set(),
      agents_claude: new Set(),
      instructions: new Set(),
      skills: new Set(),
      commands: new Set(),
      hooks: new Set(),
    };
    for (const f of managedFiles) {
      if (f.startsWith('.github/prompts/')) buckets['prompts']!.add(f);
      else if (f.startsWith('.github/agents/')) buckets['agents_github']!.add(f);
      else if (f.startsWith('.claude/agents/')) buckets['agents_claude']!.add(f);
      else if (f.startsWith('.github/instructions/')) buckets['instructions']!.add(f);
      else if (f.startsWith('.github/skills/') || f.startsWith('.claude/skills/')) buckets['skills']!.add(f);
      else if (f.startsWith('.claude/commands/')) buckets['commands']!.add(f);
      else if (f.startsWith('.github/hooks/')) buckets['hooks']!.add(f);
    }
    return buckets;
  }
}

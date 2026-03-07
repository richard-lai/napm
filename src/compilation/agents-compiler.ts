/**
 * Agents compiler — compiles AGENTS.md files (VS Code / GitHub Copilot format)
 * from discovered instruction primitives.  Supports distributed (per-directory)
 * and single-file strategies, with optional Claude target delegation.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Instruction } from '../models/primitives.js';
import { emptyDiscoveredPrimitives } from '../models/primitives.js';
import {
  discoverProjectPrimitives,
  discoverInstalledPrimitives,
} from '../primitives/discovery.js';
import { resolveMarkdownLinks } from './link-resolver.js';
import * as log from '../utils/console.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CompilationTarget = 'vscode' | 'claude' | 'all';
export type CompilationStrategy = 'distributed' | 'single-file';

export interface CompileOptions {
  projectRoot: string;
  /** Auto-detect from directory structure if not specified */
  target?: CompilationTarget;
  /** Default: distributed */
  strategy?: CompilationStrategy;
  dryRun?: boolean;
  /** Ignore apm_modules/ when true */
  localOnly?: boolean;
  /** Inline relative markdown links (default: true) */
  resolveLinks?: boolean;
  /** Override output file path (single-file strategy only) */
  outputPath?: string;
}

export interface CompileResult {
  filesWritten: string[];
  filesSkipped: string[];
  totalInstructions: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MANAGED_MARKER_START = '<!-- napm:managed:start -->';
const MANAGED_MARKER_END = '<!-- napm:managed:end -->';

// ---------------------------------------------------------------------------
// AgentsCompiler
// ---------------------------------------------------------------------------

export class AgentsCompiler {
  async compile(opts: CompileOptions): Promise<CompileResult> {
    const target = this.detectTarget(opts.projectRoot, opts.target);
    const strategy = opts.strategy ?? 'distributed';
    const shouldResolveLinks = opts.resolveLinks ?? true;

    // Gather primitives
    const projectPrims = discoverProjectPrimitives(opts.projectRoot);
    const installedPrims = opts.localOnly
      ? emptyDiscoveredPrimitives()
      : discoverInstalledPrimitives(opts.projectRoot);

    const allInstructions = [...projectPrims.instructions, ...installedPrims.instructions];

    const result: CompileResult = {
      filesWritten: [],
      filesSkipped: [],
      totalInstructions: allInstructions.length,
    };

    log.header(
      `Compiling ${allInstructions.length} instruction(s) → target: ${target}, strategy: ${strategy}`,
    );

    // ── VS Code / AGENTS.md ──────────────────────────────────────────────
    if (target === 'vscode' || target === 'all') {
      this.compileAgentsMd(allInstructions, opts, strategy, shouldResolveLinks, result);
    }

    // ── Claude / CLAUDE.md ───────────────────────────────────────────────
    if (target === 'claude' || target === 'all') {
      // Lazy import to avoid a circular dependency at module load time
      const { ClaudeCompiler } = await import('./claude-compiler.js');
      const claudeCompiler = new ClaudeCompiler();
      const claudeResult = await claudeCompiler.compile({
        projectRoot: opts.projectRoot,
        dryRun: opts.dryRun,
        localOnly: opts.localOnly,
        resolveLinks: opts.resolveLinks,
      });
      result.filesWritten.push(...claudeResult.filesWritten);
    }

    return result;
  }

  // ── Target detection ────────────────────────────────────────────────────

  private detectTarget(projectRoot: string, target?: CompilationTarget): CompilationTarget {
    if (target) return target;
    const hasGithub = fs.existsSync(path.join(projectRoot, '.github'));
    const hasClaude = fs.existsSync(path.join(projectRoot, '.claude'));
    if (hasGithub && hasClaude) return 'all';
    if (hasClaude) return 'claude';
    return 'vscode'; // default
  }

  // ── AGENTS.md compilation ───────────────────────────────────────────────

  private compileAgentsMd(
    instructions: Instruction[],
    opts: CompileOptions,
    strategy: CompilationStrategy,
    shouldResolveLinks: boolean,
    result: CompileResult,
  ): void {
    if (strategy === 'single-file') {
      const outputPath = opts.outputPath ?? path.join(opts.projectRoot, 'AGENTS.md');
      const content = this.buildAgentsMdContent(
        instructions,
        shouldResolveLinks,
        opts.projectRoot,
      );
      this.writeManaged(outputPath, content, opts.dryRun, result);
      return;
    }

    // ── Distributed: group instructions by target directory ──────────────
    const groups = new Map<string, Instruction[]>();
    for (const instr of instructions) {
      const subdir = this.getTargetSubdir(instr.applyTo);
      const bucket = groups.get(subdir) ?? [];
      bucket.push(instr);
      groups.set(subdir, bucket);
    }

    for (const [subdir, instrs] of groups) {
      const dir = subdir ? path.join(opts.projectRoot, subdir) : opts.projectRoot;
      const outputPath = path.join(dir, 'AGENTS.md');
      const content = this.buildAgentsMdContent(instrs, shouldResolveLinks, dir);
      this.writeManaged(outputPath, content, opts.dryRun, result);
    }
  }

  /**
   * Determine which project subdirectory an instruction belongs to based on
   * its `applyTo` glob pattern.
   *
   * Rules:
   *   - Empty, `**\/*`, or patterns starting with `**` → project root ("")
   *   - `src/**` → "src"
   *   - `src/components/**` → "src" (first segment only)
   */
  private getTargetSubdir(applyTo: string): string {
    if (!applyTo || applyTo === '**/*') return '';
    const parts = applyTo.split('/');
    const first = parts[0];
    if (first === undefined || first.startsWith('*') || first.startsWith('!')) return '';
    return first;
  }

  // ── Content builders ────────────────────────────────────────────────────

  private buildAgentsMdContent(
    instructions: Instruction[],
    shouldResolveLinks: boolean,
    baseDir: string,
  ): string {
    let content = `${MANAGED_MARKER_START}\n`;
    content += `<!-- Generated by napm. Do not edit manually. -->\n\n`;

    for (const instr of instructions) {
      if (instr.applyTo) {
        content += `---\napplyTo: "${instr.applyTo}"\n---\n\n`;
      }
      let body = instr.content;
      if (shouldResolveLinks) {
        body = resolveMarkdownLinks(body, path.dirname(instr.filePath));
      }
      content += body + '\n\n';
    }

    content += MANAGED_MARKER_END;
    return content;
  }

  // ── File I/O ────────────────────────────────────────────────────────────

  /**
   * Write `newManaged` to `filePath`, preserving any content that exists
   * outside the managed markers.  If no markers are found the file is
   * replaced entirely.
   */
  private writeManaged(
    filePath: string,
    newManaged: string,
    dryRun: boolean | undefined,
    result: CompileResult,
  ): void {
    if (dryRun) {
      log.dim(`[dry-run] Would write: ${filePath}`);
      result.filesSkipped.push(filePath);
      return;
    }

    let finalContent = newManaged;

    if (fs.existsSync(filePath)) {
      const existing = fs.readFileSync(filePath, 'utf-8');
      const startIdx = existing.indexOf(MANAGED_MARKER_START);
      const endIdx = existing.indexOf(MANAGED_MARKER_END);

      if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        // Splice the managed section in-place, preserving surrounding content
        const before = existing.slice(0, startIdx);
        const after = existing.slice(endIdx + MANAGED_MARKER_END.length);
        finalContent = before + newManaged + after;
      }
      // If markers are absent, overwrite the whole file
    }

    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(filePath, finalContent, 'utf-8');
    log.success(`Written: ${filePath}`);
    result.filesWritten.push(filePath);
  }
}

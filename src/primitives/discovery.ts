/**
 * Primitive discovery — scans a package or project directory and collects all
 * Instructions, Prompts, Agents, Chatmodes, Skills, and Hooks it contains.
 */

import path from 'node:path';
import fs from 'node:fs';
import { parseMarkdown } from './parser.js';
import { walkDir, toPosixRelative, readText } from '../utils/fs.js';
import {
  type Instruction,
  type Prompt,
  type Agent,
  type Chatmode,
  type Skill,
  type Hook,
  type DiscoveredPrimitives,
  emptyDiscoveredPrimitives,
} from '../models/primitives.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function nameFromFile(filePath: string, suffix: string): string {
  const base = path.basename(filePath);
  return base.endsWith(suffix) ? base.slice(0, -suffix.length) : base;
}

function collectInstructions(dir: string, relBase: string): Instruction[] {
  return walkDir(dir, ['.instructions.md']).flatMap((filePath) => {
    const raw = readText(filePath);
    if (!raw) return [];
    const { frontmatter, content } = parseMarkdown(raw);
    return [
      {
        kind: 'instruction' as const,
        filePath,
        relativePath: toPosixRelative(relBase, filePath),
        name: frontmatter.name ?? nameFromFile(filePath, '.instructions.md'),
        applyTo: frontmatter.applyTo ?? '',
        description: frontmatter.description ?? '',
        content,
        frontmatter,
      },
    ];
  });
}

function collectPrompts(dir: string, relBase: string): Prompt[] {
  return walkDir(dir, ['.prompt.md']).flatMap((filePath) => {
    const raw = readText(filePath);
    if (!raw) return [];
    const { frontmatter, content } = parseMarkdown(raw);
    return [
      {
        kind: 'prompt' as const,
        filePath,
        relativePath: toPosixRelative(relBase, filePath),
        name: frontmatter.name ?? nameFromFile(filePath, '.prompt.md'),
        description: frontmatter.description ?? '',
        content,
        frontmatter,
      },
    ];
  });
}

function collectAgents(dir: string, relBase: string): Agent[] {
  return walkDir(dir, ['.agent.md']).flatMap((filePath) => {
    const raw = readText(filePath);
    if (!raw) return [];
    const { frontmatter, content } = parseMarkdown(raw);
    return [
      {
        kind: 'agent' as const,
        filePath,
        relativePath: toPosixRelative(relBase, filePath),
        name: frontmatter.name ?? nameFromFile(filePath, '.agent.md'),
        description: frontmatter.description ?? '',
        content,
        frontmatter,
      },
    ];
  });
}

function collectChatmodes(dirs: string[], relBase: string): Chatmode[] {
  const seen = new Set<string>();
  const result: Chatmode[] = [];
  for (const dir of dirs) {
    for (const filePath of walkDir(dir, ['.chatmode.md'])) {
      if (seen.has(filePath)) continue;
      seen.add(filePath);
      const raw = readText(filePath);
      if (!raw) continue;
      const { frontmatter, content } = parseMarkdown(raw);
      result.push({
        kind: 'chatmode',
        filePath,
        relativePath: toPosixRelative(relBase, filePath),
        name: frontmatter.name ?? nameFromFile(filePath, '.chatmode.md'),
        description: frontmatter.description ?? '',
        content,
        frontmatter,
      });
    }
  }
  return result;
}

function collectSkillsFromDir(skillsDir: string): Skill[] {
  if (!fs.existsSync(skillsDir)) return [];
  const result: Skill[] = [];
  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillDir = path.join(skillsDir, entry.name);
    const skillMdPath = path.join(skillDir, 'SKILL.md');
    if (!fs.existsSync(skillMdPath)) continue;
    const raw = readText(skillMdPath);
    if (!raw) continue;
    const { frontmatter, content } = parseMarkdown(raw);
    result.push({
      kind: 'skill',
      dirPath: skillDir,
      name: frontmatter.name ?? entry.name,
      description: frontmatter.description ?? '',
      skillMdPath,
      content,
    });
  }
  return result;
}

function collectHooks(dirs: string[], relBase: string): Hook[] {
  const seen = new Set<string>();
  const result: Hook[] = [];
  for (const hooksDir of dirs) {
    for (const filePath of walkDir(hooksDir, ['.json'])) {
      if (seen.has(filePath)) continue;
      seen.add(filePath);
      const raw = readText(filePath);
      if (!raw) continue;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) continue;
        const hookContent = parsed as Record<string, unknown>;
        const filename = path.basename(filePath);
        result.push({
          kind: 'hook',
          filePath,
          relativePath: toPosixRelative(relBase, filePath),
          name: filename.endsWith('.json') ? filename.slice(0, -5) : filename,
          content: hookContent,
        });
      } catch {
        // Invalid JSON — skip silently
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Discover all primitives within a package's install directory (or any root).
 *
 * @param rootPath     Absolute path to the package / project root to scan.
 * @param relativeBase Base path used to compute `relativePath` on each primitive.
 *                     Defaults to `rootPath`. Pass `projectRoot` when scanning
 *                     installed packages so that relativePaths are project-relative.
 */
export function discoverPrimitives(rootPath: string, relativeBase?: string): DiscoveredPrimitives {
  const result = emptyDiscoveredPrimitives();
  if (!fs.existsSync(rootPath)) return result;

  const relBase = relativeBase ?? rootPath;
  const apmDir = path.join(rootPath, '.apm');

  // ── .apm/instructions/ ─────────────────────────────────────────────────
  result.instructions.push(...collectInstructions(path.join(apmDir, 'instructions'), relBase));

  // ── .apm/prompts/ ──────────────────────────────────────────────────────
  result.prompts.push(...collectPrompts(path.join(apmDir, 'prompts'), relBase));

  // ── .apm/agents/ (Agents) ──────────────────────────────────────────────
  const agentsDir = path.join(apmDir, 'agents');
  result.agents.push(...collectAgents(agentsDir, relBase));

  // ── .apm/agents/ + .apm/chatmodes/ (Chatmodes) ────────────────────────
  result.chatmodes.push(
    ...collectChatmodes([agentsDir, path.join(apmDir, 'chatmodes')], relBase),
  );

  // ── .apm/skills/<subdir>/SKILL.md ─────────────────────────────────────
  result.skills.push(...collectSkillsFromDir(path.join(apmDir, 'skills')));

  // ── Root-level SKILL.md (the package itself is a skill) ────────────────
  const rootSkillMd = path.join(rootPath, 'SKILL.md');
  if (fs.existsSync(rootSkillMd)) {
    const raw = readText(rootSkillMd);
    if (raw) {
      const { frontmatter, content } = parseMarkdown(raw);
      result.skills.push({
        kind: 'skill',
        dirPath: rootPath,
        name: frontmatter.name ?? path.basename(rootPath),
        description: frontmatter.description ?? '',
        skillMdPath: rootSkillMd,
        content,
      });
    }
  }

  // ── Hooks: .apm/hooks/ and hooks/ ──────────────────────────────────────
  result.hooks.push(
    ...collectHooks([path.join(apmDir, 'hooks'), path.join(rootPath, 'hooks')], relBase),
  );

  // ── Root-level virtual-file primitives ─────────────────────────────────
  // These support "single-file packages" that are just a bare markdown primitive.
  for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const name = entry.name;
    const filePath = path.join(rootPath, name);

    if (name.endsWith('.instructions.md')) {
      const raw = readText(filePath);
      if (!raw) continue;
      const { frontmatter, content } = parseMarkdown(raw);
      result.instructions.push({
        kind: 'instruction',
        filePath,
        relativePath: toPosixRelative(relBase, filePath),
        name: frontmatter.name ?? nameFromFile(filePath, '.instructions.md'),
        applyTo: frontmatter.applyTo ?? '',
        description: frontmatter.description ?? '',
        content,
        frontmatter,
      });
    } else if (name.endsWith('.prompt.md')) {
      const raw = readText(filePath);
      if (!raw) continue;
      const { frontmatter, content } = parseMarkdown(raw);
      result.prompts.push({
        kind: 'prompt',
        filePath,
        relativePath: toPosixRelative(relBase, filePath),
        name: frontmatter.name ?? nameFromFile(filePath, '.prompt.md'),
        description: frontmatter.description ?? '',
        content,
        frontmatter,
      });
    } else if (name.endsWith('.agent.md')) {
      const raw = readText(filePath);
      if (!raw) continue;
      const { frontmatter, content } = parseMarkdown(raw);
      result.agents.push({
        kind: 'agent',
        filePath,
        relativePath: toPosixRelative(relBase, filePath),
        name: frontmatter.name ?? nameFromFile(filePath, '.agent.md'),
        description: frontmatter.description ?? '',
        content,
        frontmatter,
      });
    }
  }

  return result;
}

/** Discover primitives in the project's own .apm/ directory and root */
export function discoverProjectPrimitives(projectRoot: string): DiscoveredPrimitives {
  return discoverPrimitives(projectRoot);
}

/** Discover all primitives from installed packages in apm_modules/ */
export function discoverInstalledPrimitives(projectRoot: string): DiscoveredPrimitives {
  const result = emptyDiscoveredPrimitives();
  const modulesRoot = path.join(projectRoot, 'apm_modules');
  if (!fs.existsSync(modulesRoot)) return result;

  // Walk apm_modules/<owner>/<repo> — exactly 2 levels deep
  const owners = fs
    .readdirSync(modulesRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  for (const owner of owners) {
    const ownerDir = path.join(modulesRoot, owner);
    const repos = fs
      .readdirSync(ownerDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);

    for (const repo of repos) {
      // Pass projectRoot as relativeBase so all relativePaths are project-relative.
      // This ensures @import paths in CLAUDE.md are correct from the project root.
      const pkgPrimitives = discoverPrimitives(path.join(ownerDir, repo), projectRoot);
      result.instructions.push(...pkgPrimitives.instructions);
      result.prompts.push(...pkgPrimitives.prompts);
      result.agents.push(...pkgPrimitives.agents);
      result.chatmodes.push(...pkgPrimitives.chatmodes);
      result.skills.push(...pkgPrimitives.skills);
      result.hooks.push(...pkgPrimitives.hooks);
    }
  }

  return result;
}

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { discoverPrimitives } from '../src/primitives/discovery.js';

function createDir(base: string, ...parts: string[]): string {
  const p = path.join(base, ...parts);
  fs.mkdirSync(p, { recursive: true });
  return p;
}

describe('discoverPrimitives', () => {
  let pkgRoot: string;

  beforeEach(() => {
    pkgRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'napm-disc-test-'));
  });

  afterEach(() => {
    fs.rmSync(pkgRoot, { recursive: true, force: true });
  });

  it('returns empty result for empty directory', () => {
    const result = discoverPrimitives(pkgRoot);
    expect(result.instructions).toHaveLength(0);
    expect(result.prompts).toHaveLength(0);
    expect(result.agents).toHaveLength(0);
    expect(result.skills).toHaveLength(0);
    expect(result.hooks).toHaveLength(0);
  });

  it('discovers .instructions.md files', () => {
    const dir = createDir(pkgRoot, '.apm', 'instructions');
    fs.writeFileSync(
      path.join(dir, 'python.instructions.md'),
      '---\napplyTo: "**/*.py"\ndescription: Python standards\n---\nUse type hints.',
      'utf-8',
    );
    const result = discoverPrimitives(pkgRoot);
    expect(result.instructions).toHaveLength(1);
    expect(result.instructions[0]!.name).toBe('python');
    expect(result.instructions[0]!.applyTo).toBe('**/*.py');
    expect(result.instructions[0]!.content).toContain('Use type hints');
  });

  it('discovers .prompt.md files', () => {
    const dir = createDir(pkgRoot, '.apm', 'prompts');
    fs.writeFileSync(
      path.join(dir, 'review.prompt.md'),
      '---\ndescription: Code review prompt\n---\nDo a thorough review.',
      'utf-8',
    );
    const result = discoverPrimitives(pkgRoot);
    expect(result.prompts).toHaveLength(1);
    expect(result.prompts[0]!.name).toBe('review');
  });

  it('discovers .agent.md files', () => {
    const dir = createDir(pkgRoot, '.apm', 'agents');
    fs.writeFileSync(
      path.join(dir, 'reviewer.agent.md'),
      '---\ndescription: Reviewer agent\n---\nYou are a code reviewer.',
      'utf-8',
    );
    const result = discoverPrimitives(pkgRoot);
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0]!.name).toBe('reviewer');
  });

  it('discovers skills from .apm/skills/<name>/SKILL.md', () => {
    const skillDir = createDir(pkgRoot, '.apm', 'skills', 'form-builder');
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '# Form Builder Skill\nBuilds forms.',
      'utf-8',
    );
    const result = discoverPrimitives(pkgRoot);
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0]!.name).toBe('form-builder');
  });

  it('discovers hooks from hooks/ directory', () => {
    const hooksDir = createDir(pkgRoot, 'hooks');
    fs.writeFileSync(
      path.join(hooksDir, 'pre-tool.json'),
      JSON.stringify({ type: 'pre-tool', command: 'lint' }),
      'utf-8',
    );
    const result = discoverPrimitives(pkgRoot);
    expect(result.hooks).toHaveLength(1);
    expect(result.hooks[0]!.name).toBe('pre-tool');
  });
});

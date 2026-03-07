import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PromptIntegrator } from '../src/integration/prompt-integrator.js';
import { AgentIntegrator } from '../src/integration/agent-integrator.js';
import { InstructionIntegrator } from '../src/integration/instruction-integrator.js';

function createDir(base: string, ...parts: string[]): string {
  const p = path.join(base, ...parts);
  fs.mkdirSync(p, { recursive: true });
  return p;
}

describe('PromptIntegrator', () => {
  let tmpDir: string;
  let installPath: string;
  let projectRoot: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'napm-int-test-'));
    installPath = createDir(tmpDir, 'pkg');
    projectRoot = createDir(tmpDir, 'project');
    // Create .github/ so shouldIntegrate returns true
    createDir(projectRoot, '.github');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('shouldIntegrate returns true when .github exists', () => {
    const integrator = new PromptIntegrator();
    expect(integrator.shouldIntegrate(projectRoot)).toBe(true);
  });

  it('shouldIntegrate returns false when .github is absent', () => {
    const noGithub = createDir(tmpDir, 'no-github');
    expect(new PromptIntegrator().shouldIntegrate(noGithub)).toBe(false);
  });

  it('deploys .prompt.md from .apm/prompts/ to .github/prompts/', () => {
    const promptDir = createDir(installPath, '.apm', 'prompts');
    fs.writeFileSync(path.join(promptDir, 'review.prompt.md'), '# Review\nDo a review', 'utf-8');

    const integrator = new PromptIntegrator();
    const result = integrator.integrate({ installPath, projectRoot });

    expect(result.filesIntegrated).toBe(1);
    const dest = path.join(projectRoot, '.github', 'prompts', 'review.prompt.md');
    expect(fs.existsSync(dest)).toBe(true);
    expect(fs.readFileSync(dest, 'utf-8')).toBe('# Review\nDo a review');
  });

  it('skips on collision when force is false', () => {
    const promptDir = createDir(installPath, '.apm', 'prompts');
    fs.writeFileSync(path.join(promptDir, 'review.prompt.md'), '# New content', 'utf-8');
    // Pre-create different content at destination
    const destDir = createDir(projectRoot, '.github', 'prompts');
    fs.writeFileSync(path.join(destDir, 'review.prompt.md'), '# Existing content', 'utf-8');

    const integrator = new PromptIntegrator();
    const result = integrator.integrate({ installPath, projectRoot, force: false });

    expect(result.filesSkipped).toBe(1);
    expect(result.filesIntegrated).toBe(0);
    // Existing file should be untouched
    expect(fs.readFileSync(path.join(destDir, 'review.prompt.md'), 'utf-8')).toBe('# Existing content');
  });

  it('overwrites on collision when force is true', () => {
    const promptDir = createDir(installPath, '.apm', 'prompts');
    fs.writeFileSync(path.join(promptDir, 'review.prompt.md'), '# New content', 'utf-8');
    const destDir = createDir(projectRoot, '.github', 'prompts');
    fs.writeFileSync(path.join(destDir, 'review.prompt.md'), '# Old content', 'utf-8');

    const integrator = new PromptIntegrator();
    integrator.integrate({ installPath, projectRoot, force: true });

    expect(fs.readFileSync(path.join(destDir, 'review.prompt.md'), 'utf-8')).toBe('# New content');
  });
});

describe('AgentIntegrator', () => {
  let tmpDir: string;
  let installPath: string;
  let projectRoot: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'napm-agent-test-'));
    installPath = createDir(tmpDir, 'pkg');
    projectRoot = createDir(tmpDir, 'project');
    createDir(projectRoot, '.github');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('deploys .agent.md to .github/agents/', () => {
    const agentDir = createDir(installPath, '.apm', 'agents');
    fs.writeFileSync(path.join(agentDir, 'reviewer.agent.md'), '# Reviewer Agent', 'utf-8');

    const integrator = new AgentIntegrator();
    const result = integrator.integrate({ installPath, projectRoot });

    expect(result.filesIntegrated).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(path.join(projectRoot, '.github', 'agents', 'reviewer.agent.md'))).toBe(true);
  });

  it('renames .chatmode.md to .agent.md', () => {
    const agentDir = createDir(installPath, '.apm', 'agents');
    fs.writeFileSync(path.join(agentDir, 'architect.chatmode.md'), '# Architect', 'utf-8');

    new AgentIntegrator().integrate({ installPath, projectRoot });

    expect(fs.existsSync(path.join(projectRoot, '.github', 'agents', 'architect.agent.md'))).toBe(true);
  });
});

describe('InstructionIntegrator', () => {
  let tmpDir: string;
  let installPath: string;
  let projectRoot: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'napm-instr-test-'));
    installPath = createDir(tmpDir, 'pkg');
    projectRoot = createDir(tmpDir, 'project');
    createDir(projectRoot, '.github');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('deploys .instructions.md to .github/instructions/', () => {
    const instrDir = createDir(installPath, '.apm', 'instructions');
    fs.writeFileSync(
      path.join(instrDir, 'python.instructions.md'),
      '---\napplyTo: "**/*.py"\n---\nUse type hints',
      'utf-8',
    );

    const integrator = new InstructionIntegrator();
    const result = integrator.integrate({ installPath, projectRoot });

    expect(result.filesIntegrated).toBe(1);
    expect(
      fs.existsSync(path.join(projectRoot, '.github', 'instructions', 'python.instructions.md')),
    ).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import { DependencyReference } from '../src/models/dependency-reference.js';

describe('DependencyReference.parse()', () => {
  it('parses GitHub shorthand owner/repo', () => {
    const ref = DependencyReference.parse('microsoft/apm-sample-package');
    expect(ref.host).toBe('github.com');
    expect(ref.repoUrl).toBe('microsoft/apm-sample-package');
    expect(ref.isVirtual).toBe(false);
    expect(ref.virtualPath).toBeUndefined();
  });

  it('parses GitHub shorthand owner/repo/subpath (virtual subdir)', () => {
    const ref = DependencyReference.parse('anthropics/skills/skills/frontend-design');
    expect(ref.host).toBe('github.com');
    expect(ref.repoUrl).toBe('anthropics/skills');
    expect(ref.isVirtual).toBe(true);
    expect(ref.virtualPath).toBe('skills/frontend-design');
  });

  it('parses virtual file reference', () => {
    const ref = DependencyReference.parse('github/awesome-copilot/agents/api-architect.agent.md');
    expect(ref.host).toBe('github.com');
    expect(ref.repoUrl).toBe('github/awesome-copilot');
    expect(ref.isVirtual).toBe(true);
    expect(ref.virtualPath).toBe('agents/api-architect.agent.md');
  });

  it('parses HTTPS GitHub URL', () => {
    const ref = DependencyReference.parse('https://github.com/microsoft/apm-sample-package.git');
    expect(ref.host).toBe('github.com');
    expect(ref.repoUrl).toBe('microsoft/apm-sample-package');
    expect(ref.isVirtual).toBe(false);
  });

  it('parses HTTPS URL without .git suffix', () => {
    const ref = DependencyReference.parse('https://github.com/microsoft/apm-sample-package');
    expect(ref.host).toBe('github.com');
    expect(ref.repoUrl).toBe('microsoft/apm-sample-package');
  });

  it('parses SSH git URL', () => {
    const ref = DependencyReference.parse('git@github.com:microsoft/apm-sample-package.git');
    expect(ref.host).toBe('github.com');
    expect(ref.repoUrl).toBe('microsoft/apm-sample-package');
  });

  it('parses GitLab FQDN shorthand', () => {
    const ref = DependencyReference.parse('gitlab.com/acme/coding-standards');
    expect(ref.host).toBe('gitlab.com');
    expect(ref.repoUrl).toBe('acme/coding-standards');
  });

  it('parses Azure DevOps shorthand', () => {
    const ref = DependencyReference.parse('dev.azure.com/myorg/myproject/myrepo');
    expect(ref.host).toBe('dev.azure.com');
    expect(ref.repoUrl).toBe('myorg/myproject/myrepo');
    expect(ref.adoOrganization).toBe('myorg');
    expect(ref.adoProject).toBe('myproject');
    expect(ref.adoRepo).toBe('myrepo');
  });

  it('getIdentity returns repoUrl for non-virtual', () => {
    const ref = DependencyReference.parse('microsoft/apm');
    expect(ref.getIdentity()).toBe('microsoft/apm');
  });

  it('getIdentity includes virtual path for virtual packages', () => {
    const ref = DependencyReference.parse('github/awesome-copilot/skills/review-and-refactor');
    expect(ref.getIdentity()).toBe('github/awesome-copilot/skills/review-and-refactor');
  });

  it('getCloneUrl returns HTTPS clone URL', () => {
    const ref = DependencyReference.parse('microsoft/apm-sample-package');
    expect(ref.getCloneUrl()).toBe('https://github.com/microsoft/apm-sample-package.git');
  });

  it('throws for invalid shorthand (single segment)', () => {
    expect(() => DependencyReference.parse('onlyone')).toThrow();
  });
});

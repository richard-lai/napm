/**
 * DependencyReference — parses and normalises the many ways a package can be
 * specified in apm.yml, matching the Python APM's DependencyReference spec.
 *
 * Supported input forms:
 *   owner/repo
 *   owner/repo/path/to/subdir
 *   owner/repo/file.prompt.md
 *   https://github.com/owner/repo.git
 *   https://gitlab.com/owner/repo
 *   git@github.com:owner/repo.git
 *   gitlab.com/owner/repo           (FQDN shorthand)
 *   dev.azure.com/org/project/repo  (Azure DevOps)
 *   ghe.company.com/owner/repo      (GitHub Enterprise)
 */

const VIRTUAL_EXTENSIONS = [
  '.prompt.md',
  '.instructions.md',
  '.agent.md',
  '.chatmode.md',
  '.skill.md',
];

const GITHUB_HOST = 'github.com';
const ADO_HOST = 'dev.azure.com';

export class DependencyReference {
  /** Canonical "owner/repo" or "org/project/repo" for ADO */
  readonly repoUrl: string;
  /** Lowercase git host, e.g. "github.com" */
  readonly host: string;
  /** Git ref (branch / tag / SHA), optional */
  readonly reference?: string;
  /** Optional local alias */
  readonly alias?: string;
  /** Path within the repo for virtual packages (subdirectory or file) */
  readonly virtualPath?: string;
  readonly isVirtual: boolean;
  /** Azure DevOps fields */
  readonly adoOrganization?: string;
  readonly adoProject?: string;
  readonly adoRepo?: string;

  constructor(opts: {
    repoUrl: string;
    host: string;
    reference?: string;
    alias?: string;
    virtualPath?: string;
    isVirtual?: boolean;
    adoOrganization?: string;
    adoProject?: string;
    adoRepo?: string;
  }) {
    this.repoUrl = opts.repoUrl;
    this.host = opts.host;
    this.reference = opts.reference;
    this.alias = opts.alias;
    this.virtualPath = opts.virtualPath;
    this.isVirtual = opts.isVirtual ?? false;
    this.adoOrganization = opts.adoOrganization;
    this.adoProject = opts.adoProject;
    this.adoRepo = opts.adoRepo;
  }

  /**
   * Identity uniquely identifies the logical package (repo + virtual path),
   * independent of host / URL format variation.
   */
  getIdentity(): string {
    if (this.isVirtual && this.virtualPath) {
      return `${this.repoUrl}/${this.virtualPath}`;
    }
    return this.repoUrl;
  }

  /**
   * Unique key used as the primary index in apm.lock.
   * Same as getIdentity() — kept as a distinct method for future extensibility.
   */
  getUniqueKey(): string {
    return this.getIdentity();
  }

  /** Full clone URL (HTTPS) */
  getCloneUrl(): string {
    return `https://${this.host}/${this.repoUrl}.git`;
  }

  /** Serialise back to the canonical apm.yml shorthand string */
  toString(): string {
    const base = this.host === GITHUB_HOST ? this.repoUrl : `${this.host}/${this.repoUrl}`;
    if (this.isVirtual && this.virtualPath) {
      return `${base}/${this.virtualPath}`;
    }
    return base;
  }

  // ---------------------------------------------------------------------------
  // Static factories
  // ---------------------------------------------------------------------------

  /** Parse a string dependency entry from apm.yml */
  static parse(raw: string): DependencyReference {
    const trimmed = raw.trim();

    // SSH URL: git@host:owner/repo.git
    const sshMatch = trimmed.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
    if (sshMatch) {
      const host = sshMatch[1]!.toLowerCase();
      const repoPath = sshMatch[2]!;
      return DependencyReference._fromHostAndPath(host, repoPath);
    }

    // HTTPS URL: https://host/...
    if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
      const url = new URL(trimmed);
      const host = url.hostname.toLowerCase();
      // Remove leading slash and trailing .git
      const repoPath = url.pathname.replace(/^\//, '').replace(/\.git$/, '');
      return DependencyReference._fromHostAndPath(host, repoPath);
    }

    // FQDN shorthand: host/owner/repo[/path]  (host contains a dot and is not a plain owner)
    const firstSegment = trimmed.split('/')[0] ?? '';
    if (firstSegment.includes('.') && !trimmed.startsWith('dev.azure.com')) {
      const withoutFirst = trimmed.substring(firstSegment.length + 1);
      return DependencyReference._fromHostAndPath(firstSegment.toLowerCase(), withoutFirst);
    }

    // Azure DevOps shorthand: dev.azure.com/org/project/repo[/path]
    if (trimmed.startsWith('dev.azure.com/')) {
      const rest = trimmed.substring('dev.azure.com/'.length);
      return DependencyReference._fromHostAndPath(ADO_HOST, rest);
    }

    // GitHub shorthand: owner/repo[/path]
    return DependencyReference._fromHostAndPath(GITHUB_HOST, trimmed);
  }

  /** Parse from a dict entry in apm.yml (object syntax with optional keys) */
  static parseFromDict(dict: Record<string, unknown>): DependencyReference {
    const src =
      (dict['source'] as string | undefined) ??
      (dict['url'] as string | undefined) ??
      (dict['package'] as string | undefined);
    if (!src) {
      throw new Error(`Cannot parse DependencyReference from dict: ${JSON.stringify(dict)}`);
    }
    const ref = DependencyReference.parse(src);
    const alias = dict['alias'] as string | undefined;
    const reference = (dict['ref'] as string | undefined) ?? (dict['branch'] as string | undefined);
    return new DependencyReference({ ...ref, alias, reference: reference ?? ref.reference });
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private static _fromHostAndPath(host: string, repoPath: string): DependencyReference {
    // Azure DevOps: org/project/repo[/path]
    if (host === ADO_HOST) {
      const parts = repoPath.split('/');
      if (parts.length < 3) {
        throw new Error(`Invalid Azure DevOps reference — expected org/project/repo: ${repoPath}`);
      }
      const [org, project, repo, ...rest] = parts as [string, string, string, ...string[]];
      const repoUrl = `${org}/${project}/${repo}`;
      const virtualPath = rest.length > 0 ? rest.join('/') : undefined;
      const isVirtual = virtualPath !== undefined;
      return new DependencyReference({
        repoUrl,
        host,
        virtualPath,
        isVirtual,
        adoOrganization: org,
        adoProject: project,
        adoRepo: repo,
      });
    }

    // Standard: owner/repo[/path]
    const parts = repoPath.split('/');
    if (parts.length < 2) {
      throw new Error(`Invalid package reference — expected owner/repo: ${repoPath}`);
    }
    const [owner, repo, ...rest] = parts as [string, string, ...string[]];
    const repoUrl = `${owner}/${repo}`;
    const virtualPath = rest.length > 0 ? rest.join('/') : undefined;
    const isVirtual =
      virtualPath !== undefined &&
      (DependencyReference._isVirtualFile(virtualPath) ||
        DependencyReference._isVirtualDir(virtualPath, rest));

    return new DependencyReference({ repoUrl, host, virtualPath, isVirtual });
  }

  private static _isVirtualFile(p: string): boolean {
    return VIRTUAL_EXTENSIONS.some((ext) => p.toLowerCase().endsWith(ext));
  }

  private static _isVirtualDir(_p: string, parts: string[]): boolean {
    // Any sub-path with more than 0 parts that isn't a known file extension
    // is treated as a virtual subdirectory.
    return parts.length > 0;
  }
}

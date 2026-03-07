/**
 * PackageDownloader — downloads APM packages from various git hosts.
 * Uses simple-git for cross-platform git operations (handles Windows paths).
 */

import simpleGit from 'simple-git';
import fs from 'node:fs';
import path from 'node:path';
import { DependencyReference } from '../models/dependency-reference.js';
import { tokenManager } from './token-manager.js';
import { ensureDir, removeDir } from '../utils/fs.js';
import * as log from '../utils/console.js';

export interface DownloadResult {
  installPath: string;
  resolvedCommit: string;
  resolvedRef: string;
}

const IS_SHA = /^[0-9a-f]{40}$/i;

export class PackageDownloader {
  private readonly modulesRoot: string;

  constructor(modulesRoot: string) {
    this.modulesRoot = modulesRoot;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Download a package. Chooses strategy based on ref type:
   * - Virtual file  → GitHub Contents API
   * - Virtual subdir → sparse-checkout with fallback to full clone + extract
   * - Regular       → shallow clone (or full clone for SHA refs)
   *
   * If `lockedCommit` is provided and the local HEAD matches it, skip download.
   */
  async download(
    ref: DependencyReference,
    lockedCommit?: string,
  ): Promise<DownloadResult> {
    const installPath = this.getInstallPath(ref);

    // Skip if already installed at the locked commit
    if (lockedCommit && fs.existsSync(installPath)) {
      const headFile = path.join(installPath, '.napm-sha');
      if (fs.existsSync(headFile)) {
        const localSha = fs.readFileSync(headFile, 'utf-8').trim();
        if (localSha === lockedCommit) {
          log.dim(`  → ${ref.repoUrl} already at ${lockedCommit.substring(0, 7)}, skipping`);
          return { installPath, resolvedCommit: lockedCommit, resolvedRef: ref.reference ?? 'HEAD' };
        }
      }
    }

    if (ref.isVirtual && ref.virtualPath) {
      const isFile = ref.virtualPath
        .split('/')
        .pop()
        ?.includes('.') ?? false;
      if (isFile) {
        return this.downloadVirtualFile(ref, installPath);
      }
      return this.downloadVirtualSubdir(ref, installPath);
    }

    return this.downloadRegularPackage(ref, installPath, lockedCommit);
  }

  // ---------------------------------------------------------------------------
  // Strategy implementations
  // ---------------------------------------------------------------------------

  private async downloadRegularPackage(
    ref: DependencyReference,
    installPath: string,
    lockedCommit?: string,
  ): Promise<DownloadResult> {
    const cloneUrl = tokenManager.buildAuthenticatedUrl(ref.getCloneUrl(), ref.host);
    const gitRef = lockedCommit ?? ref.reference;

    // Clean the destination
    if (fs.existsSync(installPath)) removeDir(installPath);
    ensureDir(path.dirname(installPath));

    const git = simpleGit();

    try {
      if (gitRef && IS_SHA.test(gitRef)) {
        // Full clone for SHA refs (can't shallow clone arbitrary commits)
        log.dim(`  ↓ ${ref.repoUrl} @ ${gitRef.substring(0, 7)} (full clone)`);
        await git.clone(cloneUrl, installPath);
        await simpleGit(installPath).checkout(gitRef);
      } else if (gitRef) {
        // Shallow clone with branch/tag name
        log.dim(`  ↓ ${ref.repoUrl} @ ${gitRef} (shallow)`);
        await git.clone(cloneUrl, installPath, ['--depth', '1', '--branch', gitRef]);
      } else {
        // Shallow clone default branch
        log.dim(`  ↓ ${ref.repoUrl} (shallow)`);
        await git.clone(cloneUrl, installPath, ['--depth', '1']);
      }
    } catch (firstErr) {
      // Retry without auth (public repos)
      const publicUrl = ref.getCloneUrl();
      if (publicUrl !== cloneUrl) {
        log.dim(`  ↺ retrying without auth…`);
        if (fs.existsSync(installPath)) removeDir(installPath);
        if (gitRef && !IS_SHA.test(gitRef)) {
          await git.clone(publicUrl, installPath, ['--depth', '1', '--branch', gitRef]);
        } else {
          await git.clone(publicUrl, installPath, ['--depth', '1']);
          if (gitRef && IS_SHA.test(gitRef)) {
            await simpleGit(installPath).checkout(gitRef);
          }
        }
      } else {
        throw firstErr;
      }
    }

    // Record resolved SHA and strip .git/
    const resolvedCommit = await this.readHead(installPath);
    this.recordSha(installPath, resolvedCommit);
    removeDir(path.join(installPath, '.git'));

    return {
      installPath,
      resolvedCommit,
      resolvedRef: gitRef ?? 'HEAD',
    };
  }

  private async downloadVirtualSubdir(
    ref: DependencyReference,
    installPath: string,
  ): Promise<DownloadResult> {
    const cloneUrl = tokenManager.buildAuthenticatedUrl(ref.getCloneUrl(), ref.host);
    const subPath = ref.virtualPath!;
    const tmpDir = installPath + '__tmp';

    if (fs.existsSync(installPath)) removeDir(installPath);
    if (fs.existsSync(tmpDir)) removeDir(tmpDir);
    ensureDir(path.dirname(installPath));

    const git = simpleGit();

    // Try sparse-checkout first (git >= 2.25)
    try {
      ensureDir(tmpDir);
      const tmpGit = simpleGit(tmpDir);
      await tmpGit.init();
      await tmpGit.addRemote('origin', cloneUrl);
      await tmpGit.raw(['sparse-checkout', 'init', '--cone']);
      await tmpGit.raw(['sparse-checkout', 'set', subPath]);
      const gitRef = ref.reference ?? 'HEAD';
      await tmpGit.fetch('origin', gitRef, ['--depth', '1']);
      await tmpGit.checkout('FETCH_HEAD');

      const subSrc = path.join(tmpDir, subPath);
      if (fs.existsSync(subSrc)) {
        const resolvedCommit = await this.readHead(tmpDir);
        // Move subdir to final location
        fs.cpSync(subSrc, installPath, { recursive: true });
        removeDir(tmpDir);
        this.recordSha(installPath, resolvedCommit);
        return { installPath, resolvedCommit, resolvedRef: gitRef };
      }
      removeDir(tmpDir);
    } catch {
      if (fs.existsSync(tmpDir)) removeDir(tmpDir);
    }

    // Fallback: full clone + extract
    log.dim(`  ↓ ${ref.repoUrl}/${subPath} (full clone fallback)`);
    const fullDir = installPath + '__full';
    if (fs.existsSync(fullDir)) removeDir(fullDir);
    const gitRef = ref.reference ?? undefined;

    if (gitRef) {
      await git.clone(cloneUrl, fullDir, ['--depth', '1', '--branch', gitRef]);
    } else {
      await git.clone(cloneUrl, fullDir, ['--depth', '1']);
    }

    const resolvedCommit = await this.readHead(fullDir);
    const subSrc = path.join(fullDir, subPath);
    if (fs.existsSync(subSrc)) {
      fs.cpSync(subSrc, installPath, { recursive: true });
    } else {
      // subPath not found — install the whole repo as fallback
      fs.cpSync(fullDir, installPath, { recursive: true });
    }
    removeDir(fullDir);

    this.recordSha(installPath, resolvedCommit);
    return { installPath, resolvedCommit, resolvedRef: gitRef ?? 'HEAD' };
  }

  private async downloadVirtualFile(
    ref: DependencyReference,
    installPath: string,
  ): Promise<DownloadResult> {
    const [owner, repo] = ref.repoUrl.split('/') as [string, string];
    const filePath = ref.virtualPath!;
    const fileName = path.basename(filePath);

    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'napm/0.1',
    };
    const pat = tokenManager.getGitHubPat();
    if (pat) headers['Authorization'] = `Bearer ${pat}`;

    const response = await fetch(apiUrl, { headers });
    if (!response.ok) {
      throw new Error(`GitHub API error ${response.status} fetching ${apiUrl}`);
    }

    const data = await response.json() as { content?: string; sha?: string; name?: string };
    if (!data.content) throw new Error(`No content in GitHub API response for ${apiUrl}`);

    const content = Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf-8');
    const resolvedCommit = data.sha ?? 'unknown';

    if (fs.existsSync(installPath)) removeDir(installPath);
    ensureDir(installPath);

    // Write the primitive file
    fs.writeFileSync(path.join(installPath, fileName), content, 'utf-8');

    // Synthesise a minimal apm.yml so validateApmPackage works
    const syntheticManifest = `name: ${ref.repoUrl.replace('/', '-')}-${fileName.replace(/\./g, '-')}\nversion: 0.0.0\n`;
    fs.writeFileSync(path.join(installPath, 'apm.yml'), syntheticManifest, 'utf-8');

    this.recordSha(installPath, resolvedCommit);
    return { installPath, resolvedCommit, resolvedRef: 'HEAD' };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  getInstallPath(ref: DependencyReference): string {
    const parts = ref.repoUrl.split('/');
    const base = path.join(this.modulesRoot, ...parts);
    if (ref.isVirtual && ref.virtualPath) {
      const virtualParts = ref.virtualPath.split('/');
      return path.join(base, ...virtualParts);
    }
    return base;
  }

  private async readHead(dir: string): Promise<string> {
    try {
      const result = await simpleGit(dir).revparse(['HEAD']);
      return result.trim();
    } catch {
      return 'unknown';
    }
  }

  private recordSha(installPath: string, sha: string): void {
    try {
      fs.writeFileSync(path.join(installPath, '.napm-sha'), sha, 'utf-8');
    } catch {
      // Best effort
    }
  }
}

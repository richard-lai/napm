/**
 * TokenManager — resolves authentication credentials for GitHub and Azure DevOps.
 * Reads from environment variables: GITHUB_APM_PAT, ADO_APM_PAT.
 */

export interface TokenConfig {
  githubPat?: string;
  adoPat?: string;
}

export class TokenManager {
  private readonly config: TokenConfig;

  constructor() {
    this.config = {
      githubPat: process.env['GITHUB_APM_PAT'],
      adoPat: process.env['ADO_APM_PAT'],
    };
  }

  getGitHubPat(): string | undefined {
    return this.config.githubPat;
  }

  getAdoPat(): string | undefined {
    return this.config.adoPat;
  }

  /**
   * Inject auth credentials into a clone URL.
   * For GitHub: https://TOKEN@github.com/owner/repo.git
   * For ADO: https://user:TOKEN@dev.azure.com/org/project/_git/repo
   */
  buildAuthenticatedUrl(cloneUrl: string, host: string): string {
    if (host === 'dev.azure.com') {
      const pat = this.config.adoPat;
      if (!pat) return cloneUrl;
      // ADO uses basic auth: https://user:PAT@dev.azure.com/...
      return cloneUrl.replace('https://', `https://napm:${pat}@`);
    }
    const pat = this.config.githubPat;
    if (!pat) return cloneUrl;
    return cloneUrl.replace('https://', `https://${pat}@`);
  }
}

export const tokenManager = new TokenManager();

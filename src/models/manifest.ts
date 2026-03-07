/**
 * ApmManifest — schema for apm.yml
 * Kept format-compatible with the Python APM tool's apm.yml spec.
 */

export type TargetType = 'vscode' | 'claude' | 'all';
export type PackageTypeLabel = 'instructions' | 'skill' | 'hybrid' | 'prompts';
export type CompilationStrategy = 'distributed' | 'single-file';

export interface McpDependency {
  /** MCP server identifier, e.g. "io.github.github/github-mcp-server" */
  id: string;
  version?: string;
  [key: string]: unknown;
}

export interface ApmDependencies {
  /** APM package references — each entry is a string or an object with extra keys */
  apm?: (string | Record<string, unknown>)[];
  /** MCP server dependencies */
  mcp?: (string | McpDependency)[];
}

export interface CompilationConfig {
  target?: TargetType;
  strategy?: CompilationStrategy;
  output?: string;
  chatmode?: string;
  resolve_links?: boolean;
  exclude?: string[];
  placement?: {
    min_instructions_per_file?: number;
  };
  source_attribution?: boolean;
}

export interface ApmManifest {
  name: string;
  version: string;
  description?: string;
  author?: string;
  license?: string;
  target?: TargetType;
  type?: PackageTypeLabel;
  scripts?: Record<string, string>;
  dependencies?: ApmDependencies;
  compilation?: CompilationConfig;
}

/** Minimal valid manifest used when auto-creating apm.yml */
export function createMinimalManifest(
  name: string,
  version = '1.0.0',
  description = '',
  author = '',
): ApmManifest {
  return { name, version, ...(description ? { description } : {}), ...(author ? { author } : {}) };
}

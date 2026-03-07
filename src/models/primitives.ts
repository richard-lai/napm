/**
 * Primitive models — typed representations of the AI agent primitives that
 * APM manages: Instructions, Prompts, Agents/Chatmodes, Skills, Hooks.
 */

export interface PrimitiveFrontmatter {
  applyTo?: string;
  description?: string;
  name?: string;
  version?: string;
  author?: string;
  [key: string]: unknown;
}

export interface Instruction {
  kind: 'instruction';
  filePath: string;
  /** Relative path inside the package's .apm/instructions/ dir */
  relativePath: string;
  name: string;
  applyTo: string;
  description: string;
  content: string;
  frontmatter: PrimitiveFrontmatter;
}

export interface Prompt {
  kind: 'prompt';
  filePath: string;
  relativePath: string;
  name: string;
  description: string;
  content: string;
  frontmatter: PrimitiveFrontmatter;
}

export interface Agent {
  kind: 'agent';
  filePath: string;
  relativePath: string;
  name: string;
  description: string;
  content: string;
  frontmatter: PrimitiveFrontmatter;
}

export interface Chatmode {
  kind: 'chatmode';
  filePath: string;
  relativePath: string;
  name: string;
  description: string;
  content: string;
  frontmatter: PrimitiveFrontmatter;
}

export interface Skill {
  kind: 'skill';
  /** Path to the skill directory */
  dirPath: string;
  name: string;
  description: string;
  skillMdPath: string;
  content: string;
}

export interface Hook {
  kind: 'hook';
  filePath: string;
  relativePath: string;
  name: string;
  content: Record<string, unknown>;
}

export type Primitive = Instruction | Prompt | Agent | Chatmode | Skill | Hook;

export interface DiscoveredPrimitives {
  instructions: Instruction[];
  prompts: Prompt[];
  agents: Agent[];
  chatmodes: Chatmode[];
  skills: Skill[];
  hooks: Hook[];
}

export function emptyDiscoveredPrimitives(): DiscoveredPrimitives {
  return {
    instructions: [],
    prompts: [],
    agents: [],
    chatmodes: [],
    skills: [],
    hooks: [],
  };
}

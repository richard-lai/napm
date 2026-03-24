# napm — Node.js Agent Package Manager

A cross-platform (Windows-first) Node.js reimplementation of [Microsoft's APM](https://github.com/microsoft/apm) — the package manager for AI agent configuration.

Declare your project's agent skills, prompts, instructions, and tools once in `apm.yml`. Every developer who clones your repo gets a fully configured AI agent setup in seconds.

> **Why napm?** Microsoft's APM does not yet work on Windows. `napm` is a drop-in equivalent built on Node.js that runs everywhere.

---

## Features

- **`apm.yml` compatible** — same manifest format as Microsoft APM; projects are interchangeable
- **`apm.lock` compatible** — reproducible installs with locked git SHAs
- **Transitive dependencies** — packages can depend on packages, fully resolved
- **All primitive types** — instructions, prompts, agents, skills, hooks
- **Multi-target integration** — deploys to `.github/` (VS Code / Copilot) and `.claude/` (Claude Code) automatically
- **AGENTS.md compilation** — distributed (per-directory) or single-file strategy
- **Works on Windows, macOS, Linux**

---

## Installation

```bash
npm install -g @rilai/napm
```

Or run without installing:

```bash
npx @rilai/napm --help
```

---

## Quick Start

```bash
# 1. Initialise a new project
napm init my-project
cd my-project

# 2. Install an APM package
napm install microsoft/apm-sample-package

# 3. Compile agent context files
napm compile
```

Your `.github/` folder is now populated with prompts, agents, and instructions ready for GitHub Copilot, Cursor, or any editor that reads `AGENTS.md`.

---

## Package Sources

`napm` installs from any git host. All forms are normalised to a canonical identity in `apm.yml`:

```bash
# GitHub shorthand
napm install owner/repo
napm install owner/repo/path/to/subdir

# Single primitive file
napm install github/awesome-copilot/agents/api-architect.agent.md

# Full HTTPS or SSH URL
napm install https://gitlab.com/acme/coding-standards.git
napm install git@github.com:owner/repo.git

# FQDN shorthand (GitLab, Bitbucket, GHE)
napm install gitlab.com/acme/repo
napm install ghe.company.com/owner/repo

# Azure DevOps
napm install dev.azure.com/org/project/repo
```

---

## apm.yml

```yaml
name: my-project
version: 1.0.0
description: My AI-native project

dependencies:
  apm:
    - microsoft/apm-sample-package
    - github/awesome-copilot/agents/api-architect.agent.md
    - anthropics/skills/skills/frontend-design

scripts:
  review: codex run review.prompt.md
```

---

## Commands

| Command | Description |
|---|---|
| `napm init [name]` | Scaffold a new `apm.yml` |
| `napm install [packages...]` | Install dependencies from `apm.yml` (or add new ones) |
| `napm uninstall <packages...>` | Remove packages and their deployed files |
| `napm prune` | Remove packages in `apm_modules/` not listed in `apm.yml` |
| `napm compile` | Compile `AGENTS.md` / `CLAUDE.md` from installed primitives |
| `napm deps list` | Table of installed packages with primitive counts |
| `napm deps tree` | Hierarchical dependency tree |
| `napm deps info <name>` | Detailed metadata for a specific package |
| `napm deps clean` | Remove all packages and `apm.lock` |
| `napm deps update [name]` | Update one or all packages to latest |
| `napm list` | List scripts defined in `apm.yml` |
| `napm run <script>` | Execute a named script from `apm.yml` |
| `napm config get [key]` | Read a configuration value |
| `napm config set <key> <value>` | Write a configuration value |

### Key options

```bash
napm install --dry-run              # Preview without writing
napm install --update               # Re-fetch, ignoring lockfile
napm install --force                # Overwrite existing files on collision
napm install --only apm             # Skip MCP dependencies
napm install --parallel-downloads 8 # Concurrent downloads (default: 4)
napm compile --target claude        # Target only Claude Code
napm compile --strategy single-file # One AGENTS.md instead of per-directory
```

---

## Authentication

For private repositories, set environment variables before running any command:

| Variable | Used for |
|---|---|
| `GITHUB_APM_PAT` | Private GitHub repositories |
| `ADO_APM_PAT` | Azure DevOps repositories |

---

## How Install Works

1. Parse `apm.yml` dependencies (or add the packages you specified)
2. Check `apm.lock` for locked commit SHAs — use them for reproducible installs
3. Download each package into `apm_modules/<owner>/<repo>/`
4. Recursively resolve transitive dependencies
5. Run integrators to deploy primitives:
   - `.prompt.md` → `.github/prompts/`
   - `.agent.md` → `.github/agents/` + `.claude/agents/`
   - `.instructions.md` → `.github/instructions/`
   - skill dirs → `.github/skills/` + `.claude/skills/`
   - `.json` hooks → `.github/hooks/`
6. Write updated `apm.lock` with resolved SHAs and deployed file paths

---

## Configuration

Config is stored in `~/.napm/config.yml`:

```bash
napm config set auto-integrate true
napm config set default-target vscode
napm config set parallel-downloads 8
```

---

## Folder Layout

After `napm install`:

```
your-project/
├── apm.yml                  # Dependency manifest (commit this)
├── apm.lock                 # Locked SHAs (commit this)
├── apm_modules/             # Downloaded packages (gitignore this)
│   └── microsoft/
│       └── apm-sample-package/
├── .github/
│   ├── prompts/             # Integrated .prompt.md files
│   ├── agents/              # Integrated .agent.md files
│   ├── instructions/        # Integrated .instructions.md files
│   └── skills/              # Integrated skill directories
└── AGENTS.md                # Compiled agent context (after napm compile)
```

---

## .gitignore

```gitignore
apm_modules/
```

Commit `apm.yml` and `apm.lock`. Ignore `apm_modules/` — it is reproducibly re-created by `napm install`.

---

## Compatibility

`napm` uses the same `apm.yml` and `apm.lock` formats as Microsoft's Python APM tool. A project initialised with either tool can be used with the other.

---

## License

MIT

// src/cli.ts
import { Command } from 'commander';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { registerInit } from './commands/init.js';
import { registerConfig } from './commands/config.js';
import { registerList } from './commands/list.js';
import { registerRun } from './commands/run.js';
import { registerInstall } from './commands/install.js';
import { registerUninstall } from './commands/uninstall.js';
import { registerPrune } from './commands/prune.js';
import { registerCompile } from './commands/compile.js';
import { registerDeps } from './commands/deps.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pkg = require(path.join(__dirname, '..', 'package.json')) as { version: string };

const program = new Command();

program
  .name('napm')
  .description('Node.js Agent Package Manager — cross-platform reimplementation of Microsoft APM')
  .version(pkg.version, '-V, --version', 'output the version number');

registerInit(program);
registerInstall(program);
registerUninstall(program);
registerPrune(program);
registerCompile(program);
registerDeps(program);
registerList(program);
registerRun(program);
registerConfig(program);

program.parse(process.argv);

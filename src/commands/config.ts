// src/commands/config.ts
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';
import type { Command } from 'commander';
import * as log from '../utils/console.js';

export interface NapmConfig {
  'auto-integrate'?: boolean;
  'default-target'?: 'vscode' | 'claude' | 'all';
  'parallel-downloads'?: number;
}

const SUPPORTED_KEYS = ['auto-integrate', 'default-target', 'parallel-downloads'] as const;
type ConfigKey = (typeof SUPPORTED_KEYS)[number];

function isSupportedKey(key: string): key is ConfigKey {
  return (SUPPORTED_KEYS as readonly string[]).includes(key);
}

export function getConfigPath(): string {
  return path.join(os.homedir(), '.napm', 'config.yml');
}

export function readConfig(): NapmConfig {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) return {};
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    return (yaml.load(raw) as NapmConfig) ?? {};
  } catch {
    return {};
  }
}

export function writeConfig(config: NapmConfig): void {
  const configPath = getConfigPath();
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const content = yaml.dump(config, { lineWidth: 120, sortKeys: false, noRefs: true });
  fs.writeFileSync(configPath, content, 'utf-8');
}

function printConfig(config: NapmConfig): void {
  let anyPrinted = false;
  for (const key of SUPPORTED_KEYS) {
    const value = config[key];
    if (value !== undefined) {
      log.kv(key, String(value));
      anyPrinted = true;
    }
  }
  if (!anyPrinted) {
    log.info('No configuration values set. Config path: ' + getConfigPath());
  }
}

function applyConfigValue(config: NapmConfig, key: ConfigKey, rawValue: string): void {
  if (key === 'auto-integrate') {
    if (rawValue === 'true' || rawValue === '1') {
      config['auto-integrate'] = true;
    } else if (rawValue === 'false' || rawValue === '0') {
      config['auto-integrate'] = false;
    } else {
      log.error(`Invalid value for auto-integrate: "${rawValue}". Use true or false.`);
      process.exit(1);
    }
  } else if (key === 'default-target') {
    if (rawValue === 'vscode' || rawValue === 'claude' || rawValue === 'all') {
      config['default-target'] = rawValue;
    } else {
      log.error(`Invalid value for default-target: "${rawValue}". Use vscode, claude, or all.`);
      process.exit(1);
    }
  } else if (key === 'parallel-downloads') {
    const n = parseInt(rawValue, 10);
    if (isNaN(n) || n < 1) {
      log.error(`Invalid value for parallel-downloads: "${rawValue}". Must be a positive integer.`);
      process.exit(1);
    }
    config['parallel-downloads'] = n;
  }
}

export function registerConfig(program: Command): void {
  const configCmd = program
    .command('config')
    .description('Get or set napm configuration values')
    .action(() => {
      const config = readConfig();
      printConfig(config);
    });

  configCmd
    .command('get [key]')
    .description('Get a configuration value (or all values if no key provided)')
    .action((key: string | undefined) => {
      const config = readConfig();
      if (!key) {
        printConfig(config);
        return;
      }
      if (!isSupportedKey(key)) {
        log.error(`Unknown config key: "${key}". Supported: ${SUPPORTED_KEYS.join(', ')}`);
        process.exit(1);
      }
      const value = config[key];
      if (value === undefined) {
        log.info(`${key} is not set`);
      } else {
        log.kv(key, String(value));
      }
    });

  configCmd
    .command('set <key> <value>')
    .description('Set a configuration value')
    .action((key: string, rawValue: string) => {
      if (!isSupportedKey(key)) {
        log.error(`Unknown config key: "${key}". Supported: ${SUPPORTED_KEYS.join(', ')}`);
        process.exit(1);
      }
      const config = readConfig();
      applyConfigValue(config, key, rawValue);
      writeConfig(config);
      log.success(`Set ${key} = ${String(config[key])}`);
    });
}

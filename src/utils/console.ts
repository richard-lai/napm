/**
 * Console utilities — chalk-based output helpers matching the Python APM's
 * _rich_info / _rich_error / _rich_success / _rich_warning signatures.
 */

import chalk from 'chalk';

export function info(msg: string): void {
  console.log(chalk.cyan('ℹ'), msg);
}

export function success(msg: string): void {
  console.log(chalk.green('✓'), msg);
}

export function warning(msg: string): void {
  console.log(chalk.yellow('⚠'), msg);
}

export function error(msg: string): void {
  console.error(chalk.red('✗'), msg);
}

export function dim(msg: string): void {
  console.log(chalk.dim(msg));
}

export function header(msg: string): void {
  console.log(chalk.bold(msg));
}

export function blank(): void {
  console.log();
}

/** Print a 2-col key:value row */
export function kv(key: string, value: string, indent = 0): void {
  const pad = ' '.repeat(indent);
  console.log(`${pad}${chalk.bold(key)}: ${value}`);
}

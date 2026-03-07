#!/usr/bin/env node

// Entry point for the napm CLI binary.
// This file is listed in package.json "bin" and must remain a plain JS/ESM shim.
import('../dist/cli.js').catch((err) => {
  console.error('Failed to start napm:', err.message);
  process.exit(1);
});

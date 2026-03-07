import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Run tests from the tests/ directory
    include: ['tests/**/*.test.ts'],
    // Use Node environment (not jsdom)
    environment: 'node',
    // Enable globals (describe, it, expect) without importing
    globals: false,
  },
});

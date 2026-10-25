import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './pact-demo',
  testMatch: '**/*.pact.spec.ts',
  workers: 1,
  timeout: 60_000,
  reporter: 'list',
});
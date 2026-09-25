import { defineConfig } from '@playwright/test';

/**
 * Screenshots for the docs site only (`npm run docs:screenshots`), kept apart from the e2e config so
 * `npm run test:e2e` never runs them.
 *
 * The shell that runs this repo's tooling sets `ELECTRON_RUN_AS_NODE=1`, which makes the Electron
 * binary behave as a bare Node process — `electron.launch()` would then never produce a window.
 */
delete process.env['ELECTRON_RUN_AS_NODE'];

export default defineConfig({
  testDir: 'tests/docs',
  testMatch: '**/*.docs.ts',
  // One window, one demo quest built step by step.
  workers: 1,
  timeout: 300000,
  reporter: [['list']],
});

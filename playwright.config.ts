import { defineConfig } from '@playwright/test';

/**
 * The shell that runs this repo's tooling sets `ELECTRON_RUN_AS_NODE=1`, which makes the Electron
 * binary behave as a bare Node process — `electron.launch()` would then never produce a window.
 * The end-to-end test inherits `process.env`, so the variable is cleared here, in the config every
 * worker loads, rather than in the test body.
 */
delete process.env['ELECTRON_RUN_AS_NODE'];

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.e2e.ts',
  // One Electron instance at a time: the app owns a SQLite store and a real world-DB connection.
  workers: 1,
  timeout: 60000,
  reporter: [['list']],
});

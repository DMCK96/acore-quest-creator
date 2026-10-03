import { defineConfig } from '@playwright/test';

/**
 * The 3D view in a browser, against a fake game client (`npm run test:world3d`). Software WebGL, so
 * it needs no graphics card. Set PW_CHROMIUM to a Chromium binary when Playwright's own is not installed.
 */
export default defineConfig({
  testDir: 'tests/world3d',
  testMatch: '**/*.spec.ts',
  timeout: 90000,
  workers: 1,
  reporter: [['list']],
  use: {
    launchOptions: {
      executablePath: process.env['PW_CHROMIUM'] || undefined,
      args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
});

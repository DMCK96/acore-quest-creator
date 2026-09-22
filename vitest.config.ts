import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const alias = {
  '@core': resolve(__dirname, 'src/core'),
  '@shared': resolve(__dirname, 'src/shared'),
};

const exclude = ['**/node_modules/**', 'tests/**/*.int.test.ts', 'tests/e2e/**'];

// environmentMatchGlobs was removed in vitest 4+, so the per-directory
// environment is expressed as two projects: node by default, jsdom for the renderer.
export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/**/*.test.{ts,tsx}'],
          exclude: [...exclude, 'tests/renderer/**'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'renderer',
          environment: 'jsdom',
          setupFiles: ['tests/renderer/setup.ts', 'tests/renderer/setup-canvas.ts'],
          include: ['tests/renderer/**/*.test.{ts,tsx}'],
          exclude,
        },
      },
    ],
  },
});

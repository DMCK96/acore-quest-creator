import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

const alias = {
  '@core': resolve(__dirname, 'src/core'),
  '@shared': resolve(__dirname, 'src/shared'),
};

export default defineConfig({
  main: {
    resolve: { alias },
  },
  preload: {
    resolve: { alias },
    build: {
      // Sandboxed preload scripts must be CommonJS.
      rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } },
    },
  },
  renderer: {
    resolve: { alias },
    plugins: [react()],
    // Wowser's scene classes start their loaders with `new Worker(new URL('./worker.js', import.meta.url))`.
    // Pre-bundled into `.vite/deps`, that URL points at a file that is not there, so in `npm run dev` the
    // workers 404 and the 3D view stays empty. Left out of pre-bundling, the workers load from the package;
    // its own dependencies are still pre-bundled, which `@wowserhq/io`'s CommonJS file shim needs.
    optimizeDeps: {
      exclude: ['@wowserhq/scene'],
      include: ['@wowserhq/io', 'gl-matrix', '@tweenjs/tween.js', 'three'],
    },
  },
});

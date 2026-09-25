/**
 * Captures the app icon from the real app: `npm run app:icon` writes `build/icon.png`, a 1024×1024
 * image of the canvas grid with the quest orb centred on it. electron-builder makes every
 * platform's icon from that one file.
 */
import { test, expect, _electron as electron } from '@playwright/test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SIZE = 1024;
// How far in from each edge must hold nothing but the background.
const BORDER = 8;
const OUT = resolve(process.cwd(), 'build', 'icon.png');

test('app icon', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js'],
    // No connection needed, and no `.env` read: the icon screen asks for nothing.
    env: { ...(Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined))), ACQC_ENV_FILE: 'none', ACQC_USER_DATA: mkdtempSync(join(tmpdir(), 'acqc-icon-ud-')) },
  });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows()[0]!;
      win.setResizable(true);
      win.setContentSize(size, size);
    }, SIZE);
    await page.setViewportSize({ width: SIZE, height: SIZE });
    await page.evaluate(() => {
      // Browser globals, reached untyped: this project's test types carry no DOM library.
      const { location } = globalThis as unknown as { location: { hash: string; reload(): void } };
      location.hash = '#icon';
      location.reload();
    });
    await page.waitForSelector('.icon-screen .quest-orb');
    // Let the particles spread round the ring and the glow reach its pulse.
    await page.waitForTimeout(3000);

    const png = await page.screenshot({ animations: 'allow' });
    expect(png.readUInt32BE(16), 'width').toBe(SIZE);
    expect(png.readUInt32BE(20), 'height').toBe(SIZE);

    // Decoded in the page's own Chromium: the brightest pixel in the border must be no brighter
    // than the background's grid, or part of the orb reaches the edge.
    const { border, grid } = await page.evaluate(async ({ b64, band }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped browser globals, as above
      const { Image, document } = globalThis as any;
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
      const light = (x: number, y: number): number => {
        const i = (y * width + x) * 4;
        return Math.max(data[i]!, data[i + 1]!, data[i + 2]!);
      };
      let edge = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (x < band || y < band || x >= width - band || y >= height - band) edge = Math.max(edge, light(x, y));
        }
      }
      // The grid's dots are the brightest thing the background draws; sample a corner block of it.
      let dots = 0;
      for (let y = 0; y < 60; y++) for (let x = 0; x < 60; x++) dots = Math.max(dots, light(x, y));
      return { border: edge, grid: dots };
    }, { b64: png.toString('base64'), band: BORDER });
    expect(border, 'nothing of the orb reaches the edge').toBeLessThanOrEqual(grid);

    mkdirSync(resolve(OUT, '..'), { recursive: true });
    writeFileSync(OUT, png);

    // The icon at the sizes an OS shows it, side by side, to judge what survives the shrink.
    const preview = await page.evaluate(async (b64) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped browser globals, as above
      const { Image, document } = globalThis as any;
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const sizes = [128, 64, 32];
      const c = document.createElement('canvas');
      c.width = sizes.reduce((w, s) => w + s + 16, 16);
      c.height = 128 + 32;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.imageSmoothingQuality = 'high';
      let x = 16;
      for (const s of sizes) {
        ctx.drawImage(img, x, 16, s, s);
        x += s + 16;
      }
      return (c.toDataURL('image/png') as string).split(',')[1]!;
    }, png.toString('base64'));
    mkdirSync(resolve('test-results'), { recursive: true });
    writeFileSync(resolve('test-results', 'icon-sizes.png'), Buffer.from(preview, 'base64'));
  } finally {
    await app.close();
  }
});

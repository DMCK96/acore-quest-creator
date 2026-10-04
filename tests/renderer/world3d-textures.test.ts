// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadSpec = vi.hoisted(() => vi.fn());
vi.mock('../../src/renderer/world3d/scene/texture/loader/TextureLoader', () => ({
  default: class {
    loadSpec = loadSpec;
  },
}));

import { clearProblems, onProblems } from '../../src/renderer/world3d/scene/diagnostics';
import TextureManager from '../../src/renderer/world3d/scene/texture/TextureManager';

const manager = () => new TextureManager({ host: { baseUrl: 'x', normalizePath: true } });

describe('a texture that cannot be loaded', () => {
  beforeEach(() => {
    loadSpec.mockReset();
    clearProblems();
  });

  it('becomes an opaque stand-in, because leaves and fences are alpha-tested and would vanish if it were see-through', async () => {
    loadSpec.mockRejectedValue(new Error('garbage'));
    const texture = (await manager().get('Tree\\Canopy.blp')) as unknown as { image: { data: Uint8Array } };
    const alphas = Array.from(texture.image.data).filter((_, i) => i % 4 === 3);
    expect(alphas).toEqual([255, 255, 255, 255]);
  });

  it('is logged once, with the reason, and not fetched again each time something asks for it', async () => {
    loadSpec.mockRejectedValue(new Error('Invalid typed array length: 4294791348'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const textures = manager();
    await textures.get('Tree\\Canopy.blp');
    await textures.get('Tree\\Canopy.blp');
    await textures.get('Tree\\Canopy.blp');
    expect(loadSpec).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatch(/texture Tree\\Canopy\.blp could not be loaded: Invalid typed array length: 4294791348/);
    warn.mockRestore();
  });

  it('stays out of the view\'s list of what is missing, because the grey stand-in leaves nothing out', async () => {
    // A modded client (Ascension) lacks many textures by design; a warning that never goes away helps no one
    loadSpec.mockRejectedValue(new Error('Error loading asset: 404 Not Found'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seen: string[][] = [];
    const stop = onProblems((all) => seen.push([...all]));
    await manager().get('World\\Wmo\\Missing.blp');
    stop();
    expect(seen.at(-1)).toEqual([]);
    vi.mocked(console.warn).mockRestore();
  });
});

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

  it('is reported once, with the reason, and not fetched again each time something asks for it', async () => {
    loadSpec.mockRejectedValue(new Error('Invalid typed array length: 4294791348'));
    const seen: string[][] = [];
    const stop = onProblems((all) => seen.push([...all]));
    const textures = manager();
    await textures.get('Tree\\Canopy.blp');
    await textures.get('Tree\\Canopy.blp');
    await textures.get('Tree\\Canopy.blp');
    stop();
    expect(loadSpec).toHaveBeenCalledTimes(1);
    const last = seen.at(-1)!;
    expect(last).toHaveLength(1);
    expect(last[0]).toMatch(/texture Tree\\Canopy\.blp could not be loaded: Invalid typed array length: 4294791348/);
  });
});

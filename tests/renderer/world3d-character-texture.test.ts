// @vitest-environment jsdom
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { solidBlp } from '../helpers/blp-file';
import { CharacterTexture } from '../../src/renderer/world3d/scene/character/CharacterTexture';

const files = (map: Record<string, Uint8Array>) => vi.fn(async (path: string) => map[path] ?? null);
const pixel = (texture: THREE.DataTexture, x: number, y: number) => {
  const { data, width } = texture.image as unknown as { data: Uint8Array; width: number };
  return Array.from(data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4));
};

describe('a dressed NPC\'s body texture', () => {
  it('is its skin with each layer painted in its region, registered for the model to use', async () => {
    const registered = new Map<string, THREE.Texture>();
    const read = files({ 'Skin.blp': solidBlp(256, 256, [200, 0, 0, 255]), 'Glove_U.blp': solidBlp(4, 4, [0, 0, 255, 255]) });
    const builder = new CharacterTexture({ read, register: (k, t) => registered.set(k, t) });
    const key = await builder.build({ base: 'Skin.blp', layers: [{ files: ['Glove_F.blp', 'Glove_U.blp'], region: 'hand' }] });
    const texture = registered.get(key!) as THREE.DataTexture;
    expect(pixel(texture, 10, 140)).toEqual([0, 0, 255, 255]);
    expect(pixel(texture, 200, 10)).toEqual([200, 0, 0, 255]);
  });

  it('falls back to the unisex file', async () => {
    const read = files({ 'Skin.blp': solidBlp(256, 256, [1, 1, 1, 255]), 'Glove_U.blp': solidBlp(4, 4, [0, 0, 255, 255]) });
    const registered = new Map<string, THREE.Texture>();
    const key = await new CharacterTexture({ read, register: (k, t) => registered.set(k, t) }).build({ base: 'Skin.blp', layers: [{ files: ['Glove_F.blp', 'Glove_U.blp'], region: 'hand' }] });
    expect(read).toHaveBeenCalledWith('Glove_F.blp');
    expect(pixel(registered.get(key!) as THREE.DataTexture, 10, 140)).toEqual([0, 0, 255, 255]);
  });

  it('builds one texture for the same layers', async () => {
    const read = files({ 'Skin.blp': solidBlp(256, 256, [1, 1, 1, 255]) });
    const register = vi.fn();
    const builder = new CharacterTexture({ read, register });
    const body = { base: 'Skin.blp', layers: [] };
    const [a, b] = await Promise.all([builder.build(body), builder.build({ ...body })]);
    expect(a).toBe(b);
    expect(register).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('leaves out a layer it cannot read, saying so once, and is null without its skin', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const builder = new CharacterTexture({ read: files({ 'Skin.blp': solidBlp(256, 256, [1, 1, 1, 255]) }), register: () => {} });
    expect(await builder.build({ base: 'Skin.blp', layers: [{ files: ['Gone_U.blp'], region: 'foot' }] })).not.toBeNull();
    expect(warn.mock.calls.filter((c) => /Gone_U\.blp/.test(String(c[0])))).toHaveLength(1);
    expect(await builder.build({ base: 'NoSkin.blp', layers: [] })).toBeNull();
    warn.mockRestore();
  });
});

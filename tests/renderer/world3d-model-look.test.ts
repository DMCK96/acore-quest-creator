// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { groupVisible, lookKey, texturePathFor } from '../../src/renderer/world3d/scene/model/look';

describe('a model drawn in a look', () => {
  it('loads a fixed texture as the model names it, whatever the look', () => {
    expect(texturePathFor({ component: 0, path: 'Creature\\Wolf\\Teeth.blp' }, { textures: { 11: 'x.blp' } })).toBe('Creature\\Wolf\\Teeth.blp');
  });

  it('fills a replaceable slot from the look', () => {
    expect(texturePathFor({ component: 11, path: '' }, { textures: { 11: 'Creature\\Wolf\\WolfSkinGrey.blp' } })).toBe('Creature\\Wolf\\WolfSkinGrey.blp');
    expect(texturePathFor({ component: 1, path: '' }, { textures: { 1: 'Textures\\BakedNpcTextures\\Abc.blp' } })).toBe('Textures\\BakedNpcTextures\\Abc.blp');
  });

  it('leaves a replaceable slot blank when the look has nothing for it', () => {
    expect(texturePathFor({ component: 12, path: '' }, { textures: { 11: 'a.blp' } })).toBeNull();
    expect(texturePathFor({ component: 12, path: '' }, undefined)).toBeNull();
  });

  it('shows every geoset when the look names none, and only the named ones otherwise', () => {
    expect(groupVisible(1301, undefined)).toBe(true);
    expect(groupVisible(1301, { geosets: null })).toBe(true);
    expect(groupVisible(0, { geosets: [0, 5, 101] })).toBe(true);
    expect(groupVisible(4, { geosets: [0, 5, 101] })).toBe(false);
  });

  it('keys the same look the same way, whatever order its slots were written in', () => {
    expect(lookKey({ textures: { 12: 'b', 11: 'a' }, geosets: [5, 0] })).toBe(lookKey({ textures: { 11: 'a', 12: 'b' }, geosets: [0, 5] }));
    expect(lookKey(undefined)).toBe(lookKey({}));
    expect(lookKey({ textures: { 11: 'a' } })).not.toBe(lookKey({ textures: { 11: 'b' } }));
  });
});

import { describe, expect, it } from 'vitest';
import { spawnedEntityOf, subjectOf } from '../../src/renderer/world3d/menu/subject';
import { spawnKindOf } from '../../src/core/entities/entity';
import { EMPTY_ENTITIES, newNpc, newObject } from '../../src/core/entities/model';
import type { MenuSpawn } from '../../src/renderer/world3d/menu/model';

const at = { x: 1, y: 2, z: 3 };
const placement = { x: 1, y: 2, z: 3, orientation: 0, rotation: null };
const info = (over: Partial<MenuSpawn> = {}): MenuSpawn => ({ kind: 'creature', guid: 80330, entry: 1423, name: 'Guard', own: false, added: false, pathId: 801, wander: 0, map: 0, group: null, placement, ...over });
const store = { ...EMPTY_ENTITIES, npcs: [{ ...newNpc(12000001), name: 'Hela' }], objects: [{ ...newObject(9100001), type: 'chest' as const }, { ...newObject(9100002) }] };

describe('the clicked thing as an entity', () => {
  it('a database NPC is existing, with its spawn existing too', () => {
    expect(spawnedEntityOf(info(), store)).toEqual({
      kind: 'npc', entry: 1423, name: 'Guard', origin: 'existing', pathId: 801, wander: 0,
      spawn: { guid: 80330, map: 0, placement, origin: 'existing' },
    });
  });

  it('a placed spawn of a database NPC is a new spawn of an existing entity', () => {
    expect(spawnedEntityOf(info({ added: true }), store)).toMatchObject({ origin: 'existing', spawn: { origin: 'new' } });
  });

  it('a project NPC and its spawn are new', () => {
    expect(spawnedEntityOf(info({ entry: 12000001, name: 'Hela', own: true }), store)).toMatchObject({ kind: 'npc', origin: 'new', spawn: { origin: 'new' } });
  });

  it('an object says whether it can be looted: a project chest yes, a project goober no, a database one cannot be changed', () => {
    const object = (entry: number, own: boolean) => info({ kind: 'object', entry, own, pathId: 0 });
    expect(spawnedEntityOf(object(9100001, true), store)).toMatchObject({ kind: 'object', lootable: true });
    expect(spawnedEntityOf(object(9100002, true), store)).toMatchObject({ kind: 'object', lootable: false });
    expect(spawnedEntityOf(object(143981, false), store)).toMatchObject({ kind: 'object', origin: 'existing', lootable: null });
  });

  it('builds ground, spawn and route point subjects from a right-click target', () => {
    expect(subjectOf({ ground: at, hit: null, selection: [] }, store)).toEqual({ type: 'ground', at, selection: [] });
    const spawn = subjectOf({ ground: at, hit: { type: 'spawn', spawn: info() }, selection: [info()] }, store);
    expect(spawn).toMatchObject({ type: 'spawn', info: info(), at, selection: [info()], target: { kind: 'npc', entry: 1423 } });
    expect(subjectOf({ ground: null, hit: { type: 'point', guid: 80330, index: 2 }, selection: [] }, store)).toEqual({ type: 'routePoint', guid: 80330, index: 2, at: null });
  });

  it('translates the 3D view and world layer kinds', () => {
    expect([spawnKindOf('creature'), spawnKindOf('object'), spawnKindOf('gameobject')]).toEqual(['npc', 'object', 'object']);
  });
});

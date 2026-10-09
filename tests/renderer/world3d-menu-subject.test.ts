import { describe, expect, it } from 'vitest';
import { spawnedEntityOf, subjectOf } from '../../src/renderer/world3d/menu/subject';
import { spawnKindOf } from '../../src/core/entities/entity';
import { EMPTY_ENTITIES, newNpc, newObject } from '../../src/core/entities/model';
import type { MenuSpawn } from '../../src/renderer/world3d/menu/model';

const at = { x: 1, y: 2, z: 3 };
const placement = { x: 1, y: 2, z: 3, orientation: 0, rotation: null };
const info = (over: Partial<MenuSpawn> = {}): MenuSpawn => ({ kind: 'creature', guid: 80330, entry: 1423, name: 'Guard', own: false, added: false, pathId: 801, wander: 0, map: 0, group: null, respawnSecs: 300, placement, ...over });
const store = { ...EMPTY_ENTITIES, npcs: [{ ...newNpc(12000001), name: 'Hela' }], objects: [{ ...newObject(9100001), type: 'chest' as const }, { ...newObject(9100002) }] };

describe('the clicked thing as an entity', () => {
  it('a database NPC is existing, with its spawn existing too', () => {
    expect(spawnedEntityOf(info(), store)).toEqual({
      kind: 'npc', entry: 1423, name: 'Guard', origin: 'existing', pathId: 801, wander: 0, vendor: { sells: false, count: null },
      spawn: { guid: 80330, map: 0, placement, origin: 'existing', group: null },
    });
  });

  it('a placed spawn of a database NPC is a new spawn of an existing entity', () => {
    expect(spawnedEntityOf(info({ added: true }), store)).toMatchObject({ origin: 'existing', spawn: { origin: 'new' } });
  });

  it('a project NPC and its spawn are new', () => {
    expect(spawnedEntityOf(info({ entry: 12000001, name: 'Hela', own: true }), store)).toMatchObject({ kind: 'npc', origin: 'new', spawn: { origin: 'new' } });
  });

  it('an NPC says whether it sells: the stock the project holds counted, a database NPC the project has not opened by its flags', () => {
    const stocked = { ...store, npcs: [{ ...newNpc(12000001), vendor: [{ item: 1, maxCount: 0, restockSecs: 0, extendedCost: 0 }] }] };
    expect(spawnedEntityOf(info({ entry: 12000001, own: true }), stocked)).toMatchObject({ vendor: { sells: true, count: 1 } });
    expect(spawnedEntityOf(info({ entry: 12000001, own: true }), store)).toMatchObject({ vendor: { sells: false, count: 0 } });
    expect(spawnedEntityOf(info({ npcFlags: 129 }), store)).toMatchObject({ vendor: { sells: true, count: null } });
    expect(spawnedEntityOf(info({ npcFlags: 3 }), store)).toMatchObject({ vendor: { sells: false, count: null } });
  });

  it('an object says whether it can be looted: a project chest yes, a project goober no, a database one cannot be changed', () => {
    const object = (entry: number, own: boolean) => info({ kind: 'object', entry, own, pathId: 0 });
    expect(spawnedEntityOf(object(9100001, true), store)).toMatchObject({ kind: 'object', lootable: true });
    expect(spawnedEntityOf(object(9100002, true), store)).toMatchObject({ kind: 'object', lootable: false });
    expect(spawnedEntityOf(object(143981, false), store)).toMatchObject({ kind: 'object', origin: 'existing', lootable: null });
  });

  it("a database object not in the project is lootable by its template type: a chest yes, another type the editor models no, any other or unknown cannot be changed", () => {
    const object = (objectType?: number) => info({ kind: 'object', entry: 143981, pathId: 0, ...(objectType === undefined ? {} : { objectType }) });
    expect(spawnedEntityOf(object(3), store)).toMatchObject({ origin: 'existing', lootable: true });
    for (const type of [2, 5, 9, 10]) expect(spawnedEntityOf(object(type), store)).toMatchObject({ lootable: false });
    for (const type of [0, 19, -1, undefined]) expect(spawnedEntityOf(object(type), store)).toMatchObject({ lootable: null });
    // The project's copy wins over the database's type
    const adopted = { ...store, objects: [{ ...newObject(143981), type: 'goober' as const, origin: { kind: 'existing' as const, original: {}, sharedLoot: 0, spawnCount: 1, locked: [] } }] };
    expect(spawnedEntityOf(object(3), adopted)).toMatchObject({ lootable: false });
  });

  it('a spawn subject says whether the project holds the entity', () => {
    const on = (spawn: MenuSpawn) => subjectOf({ ground: at, hit: { type: 'spawn', spawn }, selection: [spawn] }, store);
    expect(on(info({ kind: 'object', entry: 143981, objectType: 3 }))).toMatchObject({ stored: false });
    expect(on(info({ kind: 'object', entry: 9100001, own: true }))).toMatchObject({ stored: true });
    expect(on(info({ entry: 12000001, own: true }))).toMatchObject({ stored: true });
  });

  it('builds ground, spawn and route point subjects from a right-click target', () => {
    expect(subjectOf({ ground: at, hit: null, selection: [] }, store)).toEqual({ type: 'ground', at, selection: [] });
    const spawn = subjectOf({ ground: at, hit: { type: 'spawn', spawn: info() }, selection: [info()] }, store);
    expect(spawn).toMatchObject({ type: 'spawn', info: info(), at, selection: [info()], target: { kind: 'npc', entry: 1423 } });
    expect(subjectOf({ ground: null, hit: { type: 'point', guid: 80330, index: 2 }, selection: [] }, store)).toEqual({ type: 'routePoint', guid: 80330, index: 2, own: false, at: null });
  });

  it('carries the spawn group a spawn is in', () => {
    expect(spawnedEntityOf(info({ group: 32492 } as any), store).spawn.group).toBe(32492);
    expect(spawnedEntityOf(info(), store).spawn.group).toBeNull();
  });

  it('translates the 3D view and world layer kinds', () => {
    expect([spawnKindOf('creature'), spawnKindOf('object'), spawnKindOf('gameobject')]).toEqual(['npc', 'object', 'object']);
  });

  it('an existing NPC edited in the project stays existing; an edited existing chest can be looted unless its type is locked', () => {
    const origin = (locked: ('type' | 'loot' | 'fight')[]) => ({ kind: 'existing' as const, original: {}, sharedLoot: 0, spawnCount: 1, locked });
    const edited = { ...store, npcs: [...store.npcs, { ...newNpc(1423), origin: origin([]) }], objects: [{ ...newObject(143981), type: 'chest' as const, origin: origin([]) }, { ...newObject(5000), origin: origin(['type']) }] };
    expect(spawnedEntityOf(info(), edited)).toMatchObject({ origin: 'existing', spawn: { origin: 'existing' } });
    expect(spawnedEntityOf(info({ kind: 'object', entry: 143981 }), edited)).toMatchObject({ origin: 'existing', lootable: true });
    expect(spawnedEntityOf(info({ kind: 'object', entry: 5000 }), edited)).toMatchObject({ lootable: null });
  });
});

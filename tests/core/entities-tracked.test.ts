import { describe, expect, it } from 'vitest';
import { trackedEntities } from '../../src/core/entities/tracked';
import { EMPTY_ENTITIES, newItem, newNpc, newObject, newSpawn } from '../../src/core/entities/model';
import { EMPTY_WORLD, type WorldLayer } from '../../src/core/world/layer';

const place = (x: number) => ({ x, y: 0, z: 0, orientation: 0, rotation: null });
const look = { displayId: 1, scale: 1, equipment: [0, 0, 0] as [number, number, number], preset: null };
const idle = { type: 'idle' as const, wander: 0, pathId: null };
const store = {
  ...EMPTY_ENTITIES,
  npcs: [{ ...newNpc(12000001), name: 'Hela', spawns: [{ ...newSpawn(6000001), map: 0, x: 5, y: 6, z: 7 }] }],
  objects: [{ ...newObject(9100001), name: '' }],
  items: [{ ...newItem(9200001), name: 'Seal' }],
};

describe('trackedEntities', () => {
  it('lists every new entity once as new, NPCs then objects then items, with where to go', () => {
    expect(trackedEntities({ store, layer: EMPTY_WORLD, quests: [] })).toEqual([
      { kind: 'npc', entry: 12000001, name: 'Hela', origin: 'new', changes: ['new'], usedBy: [], goTo: { kind: 'creature', guid: 6000001, map: 0, x: 5, y: 6, z: 7 } },
      { kind: 'object', entry: 9100001, name: 'New object 9100001', origin: 'new', changes: ['new'], usedBy: [], goTo: null },
      { kind: 'item', entry: 9200001, name: 'Seal', origin: 'new', changes: ['new'], usedBy: [], goTo: null },
    ]);
  });

  it('names each existing entity a layer entry touches, merging its changes in order', () => {
    const layer: WorldLayer = {
      spawns: [{ kind: 'creature', guid: 80330, entry: 1423, name: 'Stormwind Guard', map: 0, original: place(1), current: place(2) }],
      added: [{ kind: 'gameobject', guid: 9, entry: 143981, name: 'Mailbox', map: 0, placement: place(3), look }],
      movements: [{ guid: 80331, entry: 1423, name: 'Stormwind Guard', map: 0, addonRow: true, original: idle, current: { type: 'wander', wander: 5, pathId: null } }],
      routes: [{ pathId: 802, walkers: 3, walkerEntries: [{ entry: 1423, name: 'Stormwind Guard' }, { entry: 68, name: 'City Guard' }], original: [{ x: 0, y: 0, z: 0, rest: {} }], current: [] }],
    };
    expect(trackedEntities({ store: EMPTY_ENTITIES, layer, quests: [] })).toEqual([
      { kind: 'npc', entry: 68, name: 'City Guard', origin: 'existing', changes: ['path'], usedBy: [], goTo: null },
      { kind: 'npc', entry: 1423, name: 'Stormwind Guard', origin: 'existing', changes: ['spawns', 'movement', 'path'], usedBy: [], goTo: { kind: 'creature', guid: 80330, map: 0, x: 2, y: 0, z: 0 } },
      { kind: 'object', entry: 143981, name: 'Mailbox', origin: 'existing', changes: ['spawns'], usedBy: [], goTo: { kind: 'object', guid: 9, map: 0, x: 3, y: 0, z: 0 } },
    ]);
  });

  it('a path made in the view belongs to the NPC whose movement walks it', () => {
    const layer: WorldLayer = { ...EMPTY_WORLD,
      movements: [{ guid: 80330, entry: 1423, name: 'Stormwind Guard', map: 0, addonRow: false, original: idle, current: { type: 'path', wander: 0, pathId: 803300 } }],
      routes: [{ pathId: 803300, walkers: 1, original: [], current: [{ x: 1, y: 1, z: 1, rest: {} }] }],
    };
    expect(trackedEntities({ store: EMPTY_ENTITIES, layer, quests: [] })[0]!.changes).toEqual(['movement', 'path']);
  });

  it('an entry already new keeps just new, however the layer touches it', () => {
    const layer: WorldLayer = { ...EMPTY_WORLD, added: [{ kind: 'creature', guid: 9, entry: 12000001, name: 'Hela', map: 0, placement: place(3), look }] };
    expect(trackedEntities({ store, layer, quests: [] })[0]!.changes).toEqual(['new']);
  });

  it('an older route edit without walkers is not put on any row', () => {
    const layer: WorldLayer = { ...EMPTY_WORLD, routes: [{ pathId: 801, walkers: 1, name: 'Stormwind Guard', original: [{ x: 0, y: 0, z: 0, rest: {} }], current: [] }] };
    expect(trackedEntities({ store: EMPTY_ENTITIES, layer, quests: [] })).toEqual([]);
  });

  it('says which quests use each: a new one by its uses (credits included), an existing one by what the quest names', () => {
    const none = { npcs: [], objects: [], items: [] };
    const layer: WorldLayer = { ...EMPTY_WORLD, spawns: [{ kind: 'creature', guid: 80330, entry: 1423, name: 'Stormwind Guard', map: 0, original: place(1), current: place(2) }] };
    const quests = [
      { questId: 60002, uses: { ...none, npcs: [12000001] }, refs: none },
      { questId: 60001, uses: { ...none, npcs: [12000001] }, refs: { ...none, npcs: [1423, 12000001] } },
    ];
    const rows = trackedEntities({ store, layer, quests });
    expect(rows.find((r) => r.entry === 12000001)!.usedBy).toEqual([60001, 60002]);
    expect(rows.find((r) => r.entry === 1423)!.usedBy).toEqual([60001]);
  });

  it('an existing entity edited in the project is tracked as details, merged with its layer changes', () => {
    const origin = { kind: 'existing' as const, original: {}, sharedLoot: 0, spawnCount: 1, locked: [] };
    const edited = { ...EMPTY_ENTITIES, npcs: [{ ...newNpc(1423), name: 'Stormwind Guard', origin }] };
    const layer: WorldLayer = { ...EMPTY_WORLD, spawns: [{ kind: 'creature', guid: 80330, entry: 1423, name: 'Stormwind Guard', map: 0, original: place(1), current: place(2) }] };
    expect(trackedEntities({ store: edited, layer, quests: [] })).toEqual([
      { kind: 'npc', entry: 1423, name: 'Stormwind Guard', origin: 'existing', changes: ['spawns', 'details'], usedBy: [], goTo: { kind: 'creature', guid: 80330, map: 0, x: 2, y: 0, z: 0 } },
    ]);
  });
});

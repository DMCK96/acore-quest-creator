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

  it('a respawn change is a spawns change', () => {
    const layer: WorldLayer = { ...EMPTY_WORLD, respawns: [{ kind: 'creature', guid: 80330, entry: 1423, name: 'Stormwind Guard', map: 0, original: 300, current: 60 }] };
    expect(trackedEntities({ store: EMPTY_ENTITIES, layer, quests: [] })[0]).toMatchObject({ entry: 1423, changes: ['spawns'] });
  });

  it('every entity with a spawn in a changed group has a group change', () => {
    const member = { type: 'spawn' as const, kind: 'npc' as const, guid: 39203, entry: 32491, chance: 0 };
    const layer: WorldLayer = { ...EMPTY_WORLD, groups: [{ id: 900001, name: 'Path 1', map: 571, maxActive: 1, event: null, members: [member], origin: { kind: 'new' } }] };
    expect(trackedEntities({ store: EMPTY_ENTITIES, layer, quests: [] })).toEqual([
      { kind: 'npc', entry: 32491, name: 'NPC 32491', origin: 'existing', changes: ['group'], usedBy: [], goTo: { kind: 'creature', guid: 39203, map: 571 } },
    ]);
  });

  describe('group changes: only spawns whose membership changed', () => {
    const spawn = (guid: number, entry: number, chance = 0) => ({ type: 'spawn' as const, kind: 'npc' as const, guid, entry, chance });
    const row = (guid: number, chance = 0) => ({ table: 'pool_creature' as const, row: { guid: String(guid), pool_entry: '5000', chance: String(chance), description: '' } });
    const existing = (members: ReturnType<typeof row>[]) => ({ kind: 'existing' as const, original: { template: { entry: '5000', max_limit: '1', description: 'Guards' }, members, event: null } });
    const entries: Record<number, number> = { 300: 1003 };
    const entryOfSpawn = (kind: 'npc' | 'object', guid: number): number | null => (kind === 'npc' ? entries[guid] ?? null : null);
    const changed = (layer: WorldLayer) =>
      trackedEntities({ store: EMPTY_ENTITIES, layer, quests: [], entryOfSpawn }).filter((t) => t.changes.includes('group')).map((t) => t.entry);

    it('an existing group marks the spawns added to it and the ones taken out whose entry is known, not the ones it kept', () => {
      const layer: WorldLayer = { ...EMPTY_WORLD, groups: [{ id: 5000, name: 'Guards', map: 0, maxActive: 1, event: null,
        members: [spawn(100, 1001), spawn(200, 1002)], origin: existing([row(100), row(300), row(400)]) }] };
      expect(changed(layer)).toEqual([1002, 1003]);
    });

    it('the entry of a spawn taken out can be read from the layer', () => {
      const layer: WorldLayer = { ...EMPTY_WORLD,
        respawns: [{ kind: 'creature', guid: 400, entry: 1004, name: 'Guard', map: 0, original: 300, current: 60 }],
        groups: [{ id: 5000, name: 'Guards', map: 0, maxActive: 1, event: null, members: [spawn(100, 1001)], origin: existing([row(100), row(400)]) }] };
      expect(trackedEntities({ store: EMPTY_ENTITIES, layer, quests: [] }).find((t) => t.entry === 1004)!.changes).toEqual(['spawns', 'group']);
    });

    it('a chance-only or name-only edit of an existing group changes no membership', () => {
      const layer: WorldLayer = { ...EMPTY_WORLD, groups: [{ id: 5000, name: 'Renamed', map: 0, maxActive: 1, event: null,
        members: [spawn(100, 1001, 40), spawn(300, 1003, 60)], origin: existing([row(100, 50), row(300, 50)]) }] };
      expect(changed(layer)).toEqual([]);
    });

    it('an event change on an existing group marks every current member, kept ones too', () => {
      const withEvent = (event: { id: number; during: boolean } | null, original: Record<string, string | null> | null) => ({ ...EMPTY_WORLD, groups: [{ id: 5000, name: 'Guards', map: 0, maxActive: 1, event,
        members: [spawn(100, 1001), spawn(200, 1002)], origin: { ...existing([row(100), row(200)]), original: { ...existing([row(100), row(200)]).original, event: original } } }] }) as WorldLayer;
      expect(changed(withEvent({ id: 4, during: true }, null))).toEqual([1001, 1002]);
      expect(changed(withEvent({ id: 4, during: false }, { eventEntry: '4', pool_entry: '5000' }))).toEqual([1001, 1002]);
      expect(changed(withEvent({ id: 4, during: true }, { eventEntry: '4', pool_entry: '5000' }))).toEqual([]);
    });

    it('a deleted existing group marks every original member whose entry is known, and its current members', () => {
      const layer: WorldLayer = { ...EMPTY_WORLD, groups: [{ id: 5000, name: 'Guards', map: 0, maxActive: 1, event: null, removed: true,
        members: [spawn(100, 1001)], origin: existing([row(100), row(300), row(400)]) }] };
      expect(changed(layer)).toEqual([1001, 1003]);
    });
  });

  describe('Go to for a spawn changed without being moved', () => {
    const goTo = (layer: WorldLayer) => trackedEntities({ store: EMPTY_ENTITIES, layer, quests: [] })[0]!.goTo;

    it('a movement change goes to the spawn it was made on', () => {
      expect(goTo({ ...EMPTY_WORLD, movements: [{ guid: 80331, entry: 1423, name: 'Stormwind Guard', map: 0, addonRow: true, original: idle, current: { type: 'wander', wander: 5, pathId: null } }] }))
        .toEqual({ kind: 'creature', guid: 80331, map: 0 });
    });

    it('a path made in the view goes to the spawn whose movement walks it', () => {
      const path = { ...EMPTY_WORLD, routes: [{ pathId: 803300, walkers: 1, original: [], current: [{ x: 1, y: 1, z: 1, rest: {} }] }] };
      const movement = { guid: 80330, entry: 1423, name: 'Stormwind Guard', map: 1, addonRow: false, original: idle, current: { type: 'path' as const, wander: 0, pathId: 803300 } };
      expect(trackedEntities({ store: EMPTY_ENTITIES, layer: { ...path, movements: [movement] }, quests: [] })[0]!.goTo).toEqual({ kind: 'creature', guid: 80330, map: 1 });
    });

    it('a respawn change goes to its spawn', () => {
      expect(goTo({ ...EMPTY_WORLD, respawns: [{ kind: 'gameobject', guid: 70, entry: 1731, name: 'Copper Vein', map: 0, original: 300, current: 60 }] }))
        .toEqual({ kind: 'object', guid: 70, map: 0 });
    });

    it('a moved spawn is gone to where it stands, before any spawn without a place', () => {
      const layer: WorldLayer = { ...EMPTY_WORLD,
        movements: [{ guid: 80331, entry: 1423, name: 'Stormwind Guard', map: 0, addonRow: true, original: idle, current: { type: 'wander', wander: 5, pathId: null } }],
        spawns: [{ kind: 'creature', guid: 80330, entry: 1423, name: 'Stormwind Guard', map: 0, original: place(1), current: place(2) }] };
      expect(goTo(layer)).toEqual({ kind: 'creature', guid: 80330, map: 0, x: 2, y: 0, z: 0 });
    });
  });
});

import { describe, expect, it } from 'vitest';
import {
  makeRule, npcEventsOf, npcSpawnFacts, ruleOfRows, rowsOfRule, sameRule, spawnEventPlan, spawnEventStatements,
} from '../../src/core/entities/spawn-events';
import { newNpc, newSpawn, type CustomNpc } from '../../src/core/entities/model';
import { EMPTY_WORLD, type WorldLayer } from '../../src/core/world/layer';

const row = (guid: number, eventEntry: number) => ({ eventEntry: String(eventEntry), guid: String(guid) });
const existing = (entry: number, events: CustomNpc['events']): CustomNpc => ({
  ...newNpc(entry), events, origin: { kind: 'existing', original: { creature_template: [{ entry: String(entry) }] }, sharedLoot: 0, spawnCount: 2, locked: [] },
});
const look = { displayId: 1, scale: 1, equipment: [0, 0, 0] as [number, number, number], preset: null };
const placed = (guid: number, entry: number, events?: CustomNpc['spawns'][number]['events']) =>
  ({ kind: 'creature' as const, guid, entry, name: 'G', map: 0, placement: { x: 0, y: 0, z: 0, orientation: 0, rotation: null }, look, ...(events !== undefined ? { events } : {}) });

describe('a spawn\'s event rule', () => {
  it('reads rows as one direction over sorted events, none as always, both signs as custom', () => {
    expect(ruleOfRows([])).toBeNull();
    expect(ruleOfRows([row(1, 12), row(1, 4)])).toEqual({ mode: 'during', events: [4, 12] });
    expect(ruleOfRows([row(1, -7)])).toEqual({ mode: 'except', events: [7] });
    expect(ruleOfRows([row(1, 12), row(1, -7)])).toBe('custom');
  });

  it('writes one row per event, signed by direction, and none for always', () => {
    expect(rowsOfRule(5, { mode: 'during', events: [4, 12] })).toEqual([row(5, 4), row(5, 12)]);
    expect(rowsOfRule(5, { mode: 'except', events: [7] })).toEqual([row(5, -7)]);
    expect(rowsOfRule(5, null)).toEqual([]);
  });

  it('compares rules by direction and event set; custom matches nothing', () => {
    expect(sameRule({ mode: 'during', events: [4, 12] }, { mode: 'during', events: [4, 12] })).toBe(true);
    expect(sameRule({ mode: 'during', events: [4] }, { mode: 'except', events: [4] })).toBe(false);
    expect(sameRule(null, null)).toBe(true);
    expect(sameRule(null, 'custom')).toBe(false);
  });

  it('makes a rule sorted and unique, and none from no events', () => {
    expect(makeRule('during', [12, 4, 12])).toEqual({ mode: 'during', events: [4, 12] });
    expect(makeRule('except', [])).toBeNull();
  });

  it('an NPC\'s default is the rule all its spawns share, else as each spawn has it', () => {
    expect(npcEventsOf([1, 2], [row(1, 12), row(2, 12)])).toEqual({ mode: 'during', events: [12] });
    expect(npcEventsOf([1, 2], [])).toBeNull();
    expect(npcEventsOf([1, 2], [row(1, 12)])).toBe('asIs');
    expect(npcEventsOf([1], [row(1, 12), row(1, -4)])).toBe('asIs');
    expect(npcEventsOf([], [])).toBeNull();
  });
});

describe('the spawn event plan', () => {
  const during12 = { mode: 'during' as const, events: [12] };
  const except4 = { mode: 'except' as const, events: [4] };

  it('a new NPC\'s spawns follow it unless they have their own rule', () => {
    const hela = { ...newNpc(12000001), events: during12, spawns: [newSpawn(6000001), { ...newSpawn(6000002), events: except4 }] };
    expect(spawnEventPlan({ npcs: [hela], layer: EMPTY_WORLD, dbGuids: new Map() })).toEqual([
      { guid: 6000001, entry: 12000001, rule: during12 },
      { guid: 6000002, entry: 12000001, rule: except4 },
    ]);
  });

  it('a new NPC\'s spawn set to always is always, not its NPC\'s rule', () => {
    const hela = { ...newNpc(12000001), events: during12, spawns: [{ ...newSpawn(6000001), events: null }] };
    expect(spawnEventPlan({ npcs: [hela], layer: EMPTY_WORLD, dbGuids: new Map() })).toEqual([{ guid: 6000001, entry: 12000001, rule: null }]);
  });

  it("a new NPC's spawns placed in the 3D view follow it too, unless they have their own rule", () => {
    const hela = { ...newNpc(12000001), events: during12, spawns: [newSpawn(6000001)] };
    const layer: WorldLayer = { ...EMPTY_WORLD, added: [placed(90001, 12000001), placed(90002, 12000001, except4)] };
    expect(spawnEventPlan({ npcs: [hela], layer, dbGuids: new Map() })).toEqual([
      { guid: 6000001, entry: 12000001, rule: during12 },
      { guid: 90001, entry: 12000001, rule: during12 },
      { guid: 90002, entry: 12000001, rule: except4 },
    ]);
  });

  it('leaves out a database spawn the layer deletes, so no event rows are written for a spawn the patch removes', () => {
    const gone = { kind: 'creature' as const, guid: 80330, entry: 1423, name: 'Guard', map: 0, placement: { x: 0, y: 0, z: 0, orientation: 0, rotation: null }, rows: [] };
    const layer: WorldLayer = { ...EMPTY_WORLD, deletes: [gone], spawnEvents: [{ guid: 80330, entry: 1423, name: 'Guard', map: 0, original: [], current: during12 }] };
    expect(spawnEventPlan({ npcs: [existing(1423, during12)], layer, dbGuids: new Map([[1423, [80330, 80331]]]) })).toEqual([{ guid: 80331, entry: 1423, rule: during12 }]);
  });

  it('an existing NPC covers every database spawn and its placed ones; a layer edit or a placed spawn\'s own rule wins', () => {
    const layer: WorldLayer = {
      ...EMPTY_WORLD,
      added: [placed(90001, 1423), placed(90002, 1423, null)],
      spawnEvents: [{ guid: 80331, entry: 1423, name: 'Guard', map: 0, original: [], current: except4 }],
    };
    const plan = spawnEventPlan({ npcs: [existing(1423, during12)], layer, dbGuids: new Map([[1423, [80330, 80331]]]) });
    expect(plan).toEqual([
      { guid: 80330, entry: 1423, rule: during12 },
      { guid: 80331, entry: 1423, rule: except4 },
      { guid: 90001, entry: 1423, rule: during12 },
      { guid: 90002, entry: 1423, rule: null },
    ]);
  });

  it('as each spawn has it plans only the spawns with their own rule', () => {
    const layer: WorldLayer = { ...EMPTY_WORLD, spawnEvents: [{ guid: 80331, entry: 1423, name: 'Guard', map: 0, original: [], current: null }] };
    expect(spawnEventPlan({ npcs: [existing(1423, 'asIs')], layer, dbGuids: new Map([[1423, [80330, 80331]]]) }))
      .toEqual([{ guid: 80331, entry: 1423, rule: null }]);
  });

  it('a layer edit of an NPC the project does not hold is planned on its own', () => {
    const layer: WorldLayer = { ...EMPTY_WORLD, spawnEvents: [{ guid: 5, entry: 99, name: 'Wolf', map: 0, original: [row(5, 12)], current: except4 }] };
    expect(spawnEventPlan({ npcs: [], layer, dbGuids: new Map() })).toEqual([{ guid: 5, entry: 99, rule: except4 }]);
  });
});

describe('the spawn event statements', () => {
  it('writes only spawns whose rule differs from what the database has, and the revert puts those rows back', () => {
    const plan = [
      { guid: 1, entry: 1423, rule: { mode: 'during' as const, events: [12] } },
      { guid: 2, entry: 1423, rule: { mode: 'during' as const, events: [4, 12] } },
      { guid: 3, entry: 1423, rule: null },
    ];
    const current = new Map([[1, [row(1, 12)]], [2, [row(2, -7)]], [3, [row(3, 12), row(3, -4)]]]);
    const { apply, revert } = spawnEventStatements(plan, current);
    expect(apply).toEqual([
      { kind: 'delete', table: 'game_event_creature', key: { guid: '2' } },
      { kind: 'insert', table: 'game_event_creature', row: row(2, 4) },
      { kind: 'insert', table: 'game_event_creature', row: row(2, 12) },
      { kind: 'delete', table: 'game_event_creature', key: { guid: '3' } },
    ]);
    expect(revert).toEqual([
      { kind: 'delete', table: 'game_event_creature', key: { guid: '2' } },
      { kind: 'insert', table: 'game_event_creature', row: row(2, -7) },
      { kind: 'delete', table: 'game_event_creature', key: { guid: '3' } },
      { kind: 'insert', table: 'game_event_creature', row: row(3, 12) },
      { kind: 'insert', table: 'game_event_creature', row: row(3, -4) },
    ]);
  });

  it('writes nothing for an empty plan', () => {
    expect(spawnEventStatements([], new Map())).toEqual({ apply: [], revert: [] });
  });
});

describe('an NPC\'s spawn facts', () => {
  it('counts every spawn and the ones with their own events', () => {
    const hela = { ...newNpc(12000001), spawns: [newSpawn(1), { ...newSpawn(2), events: null }] };
    expect(npcSpawnFacts(hela, EMPTY_WORLD, 0)).toEqual({ spawns: 2, overrides: 1 });
    const helaPlaced: WorldLayer = { ...EMPTY_WORLD, added: [placed(90001, 12000001), placed(90002, 12000001, null)] };
    expect(npcSpawnFacts(hela, helaPlaced, 0)).toEqual({ spawns: 4, overrides: 2 });
    const layer: WorldLayer = {
      ...EMPTY_WORLD,
      added: [placed(90001, 1423), placed(90002, 1423, null), placed(90003, 7)],
      spawnEvents: [{ guid: 80331, entry: 1423, name: 'Guard', map: 0, original: [], current: null }],
    };
    expect(npcSpawnFacts(existing(1423, null), layer, 12)).toEqual({ spawns: 14, overrides: 2 });
  });
});

describe('an NPC editor\'s spawn count, with spawns deleted in the layer', () => {
  it('takes away the database spawns of that NPC the layer deletes, and no other NPC\'s', () => {
    const gone = (guid: number, entry: number) => ({ kind: 'creature' as const, guid, entry, name: 'Guard', map: 0, placement: { x: 0, y: 0, z: 0, orientation: 0, rotation: null }, rows: [] });
    const layer: WorldLayer = { ...EMPTY_WORLD, deletes: [gone(80330, 1423), gone(80500, 999)] };
    expect(npcSpawnFacts(existing(1423, null), layer, 5)).toEqual({ spawns: 4, overrides: 0 });
  });
});

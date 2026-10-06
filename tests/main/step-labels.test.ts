import { describe, it, expect } from 'vitest';
import { describeStep } from '../../src/main/project/step-labels';
import type { HistoryStep } from '../../src/main/project/history';
import type { HistoryPart, QuestEdit } from '../../src/shared/history';
import { EMPTY_WORLD } from '../../src/core/world/layer';
import { EMPTY_ENTITIES, newNpc, newObject, newSpawn } from '../../src/core/entities/model';

const TITLE = 'quest_template.LogTitle';
const edit = (questId: number, values: Record<string, unknown>): QuestEdit => ({ questId, isNew: true,
  aggregate: { questId, isNew: true, values, readOnly: [], sharedItems: {} } as QuestEdit['aggregate'], snapshot: null, fidelity: { ok: true }, x: 0, y: 0 });
const step = (parts: HistoryPart[], label: string | null = null): HistoryStep => ({ id: 1, label, where: null, parts, explicit: label !== null, at: 0 });
const at = { x: 1, y: 2, z: 3, orientation: 0, rotation: null };

describe('describeStep', () => {
  it('names one changed field by its label and the quest by its title', () => {
    const before = edit(60012, { [TITLE]: 'Kobold Camp Cleanup', 'quest_template.QuestLevel': 1 });
    const after = edit(60012, { [TITLE]: 'Kobold Camp Cleanup', 'quest_template.QuestLevel': 5 });
    const d = describeStep(step([{ kind: 'quest', questId: 60012, before, after }]));
    expect(d.label).toMatch(/ of Kobold Camp Cleanup$/);
    expect(d.label).not.toMatch(/^Edit/);
    expect(d).toMatchObject({ kind: 'quest', where: { questId: 60012 } });
  });

  it('names a renamed quest by its new title, and an untitled one by its id', () => {
    const d = describeStep(step([{ kind: 'quest', questId: 60012, before: edit(60012, { [TITLE]: '' }), after: edit(60012, { [TITLE]: 'Kob' }) }]));
    expect(d.label).toMatch(/of Kob$/);
    const e = describeStep(step([{ kind: 'quest', questId: 60013, before: edit(60013, { x: 1, [TITLE]: '' }), after: edit(60013, { x: 2, [TITLE]: '' }) }]));
    expect(e.label).toMatch(/quest 60013$/);
  });

  it('says Edit to a quest when fields of several modules changed', () => {
    const before = edit(1, { [TITLE]: 'T', 'quest_template.QuestLevel': 1, entities: '[]' });
    const after = edit(1, { [TITLE]: 'T', 'quest_template.QuestLevel': 2, entities: '[1]' });
    expect(describeStep(step([{ kind: 'quest', questId: 1, before, after }])).label).toBe('Edit to T');
  });

  it('names new, added and removed quests', () => {
    expect(describeStep(step([{ kind: 'quest', questId: 60012, before: null, after: edit(60012, { [TITLE]: '' }) }])).label).toBe('New quest 60012');
    expect(describeStep(step([{ kind: 'quest', questId: 33, before: null, after: { ...edit(33, { [TITLE]: 'Kobold Camp Cleanup' }), isNew: false } }])).label).toBe('Added Kobold Camp Cleanup');
    const chain = [33, 34, 35].map((id): HistoryPart => ({ kind: 'quest', questId: id, before: null, after: { ...edit(id, { [TITLE]: `Q${id}` }), isNew: false } }));
    expect(describeStep(step(chain)).label).toBe('Added a chain of 3 quests');
    expect(describeStep(step([{ kind: 'quest', questId: 33, before: edit(33, { [TITLE]: 'Kobold Camp Cleanup' }), after: null }]))).toMatchObject({ label: 'Removed Kobold Camp Cleanup', where: null });
  });

  it('names graph moves and renames', () => {
    expect(describeStep(step([{ kind: 'positions', before: [{ questId: 1, x: 0, y: 0 }, { questId: 2, x: 0, y: 0 }], after: [{ questId: 1, x: 5, y: 0 }, { questId: 2, x: 5, y: 0 }] }]))).toMatchObject({ label: 'Moved 2 quests on the graph', kind: 'graph' });
    expect(describeStep(step([{ kind: 'positions', before: [{ questId: 1, x: 0, y: 0 }], after: [{ questId: 1, x: 5, y: 0 }] }])).label).toBe('Moved a quest on the graph');
    expect(describeStep(step([{ kind: 'name', before: 'A', after: 'B' }]))).toMatchObject({ label: 'Renamed the project', kind: 'project' });
  });

  it('names respawn and spawn group steps instead of counting zero changes', () => {
    const resp = { kind: 'creature' as const, guid: 80330, entry: 1423, name: 'Stormwind Guard', map: 0, original: 300, current: 60 };
    const world = (l: object) => describeStep(step([{ kind: 'world', before: EMPTY_WORLD, after: { ...EMPTY_WORLD, ...l } }]));
    expect(world({ respawns: [resp] }).label).toBe('Respawn time of Stormwind Guard');
    expect(describeStep(step([{ kind: 'world', before: { ...EMPTY_WORLD, respawns: [resp] }, after: EMPTY_WORLD }])).label).toBe('Reverted respawn time of Stormwind Guard');
    const group = { id: 5, name: 'Path 1', map: 0, maxActive: 1, members: [], origin: { kind: 'new' as const } } as any;
    expect(world({ groups: [group] }).label).toBe('Saved spawn group Path 1');
    const gone = { ...group, origin: { kind: 'existing' as const, original: { template: {}, members: [], event: null } }, removed: true };
    expect(describeStep(step([{ kind: 'world', before: { ...EMPTY_WORLD, groups: [{ ...gone, removed: false }] }, after: { ...EMPTY_WORLD, groups: [gone] } }])).label).toBe('Deleted spawn group Path 1');
    expect(describeStep(step([{ kind: 'world', before: { ...EMPTY_WORLD, groups: [group] }, after: EMPTY_WORLD }])).label).toBe('Removed spawn group Path 1');
    expect(world({ respawns: [resp, { ...resp, guid: 2 }] }).label).toBe('World: 2 changes');
  });

  it('names spawn event steps', () => {
    const ev = { guid: 80330, entry: 1423, name: 'Stormwind Guard', map: 0, original: [], current: null };
    expect(describeStep(step([{ kind: 'world', before: EMPTY_WORLD, after: { ...EMPTY_WORLD, spawnEvents: [ev] } }])).label).toBe('Events of Stormwind Guard');
    expect(describeStep(step([{ kind: 'world', before: { ...EMPTY_WORLD, spawnEvents: [ev] }, after: EMPTY_WORLD }])).label).toBe('Reverted events of Stormwind Guard');
  });

  it('names world changes from the layer\'s difference and says where', () => {
    const guard = { kind: 'creature' as const, guid: 80330, entry: 1423, name: 'Stormwind Guard', map: 0, original: at, current: { ...at, x: 9 } };
    expect(describeStep(step([{ kind: 'world', before: EMPTY_WORLD, after: { ...EMPTY_WORLD, spawns: [guard] } }])))
      .toEqual({ label: 'Moved Stormwind Guard', kind: 'world', where: { map: 0, x: 9, y: 2, z: 3, spawn: { kind: 'creature', guid: 80330 } } });
    const mailbox = { kind: 'gameobject' as const, guid: 7, entry: 143981, name: 'Mailbox', map: 0, placement: at, look: { displayId: 1, scale: 1, equipment: [0, 0, 0] as [number, number, number], preset: null } };
    expect(describeStep(step([{ kind: 'world', before: EMPTY_WORLD, after: { ...EMPTY_WORLD, added: [mailbox] } }])).label).toBe('Placed Mailbox');
    expect(describeStep(step([{ kind: 'world', before: { ...EMPTY_WORLD, added: [mailbox] }, after: EMPTY_WORLD }])).label).toBe('Removed placed Mailbox');
    expect(describeStep(step([{ kind: 'world', before: { ...EMPTY_WORLD, spawns: [guard] }, after: EMPTY_WORLD }])).label).toBe('Reverted Stormwind Guard');
    const route = { pathId: 801, walkers: 1, original: [], current: [{ x: 1, y: 1, z: 1, rest: {} }] };
    expect(describeStep(step([{ kind: 'world', before: EMPTY_WORLD, after: { ...EMPTY_WORLD, routes: [route] } }])).label).toBe('Route 801');
    const wander = { guid: 5, entry: 6, name: 'Kobold Vermin', map: 0, addonRow: true, original: { type: 'idle', wander: 0, pathId: null }, current: { type: 'wander', wander: 5, pathId: null } } as any;
    expect(describeStep(step([{ kind: 'world', before: EMPTY_WORLD, after: { ...EMPTY_WORLD, movements: [wander] } }])).label).toBe('Movement of Kobold Vermin');
    expect(describeStep(step([{ kind: 'world', before: EMPTY_WORLD, after: { ...EMPTY_WORLD, spawns: [guard, { ...guard, guid: 80331 }] } }])).label).toBe('World: 2 changes');
  });

  it('keeps a label the window gave, and its place', () => {
    const s = { ...step([{ kind: 'name', before: 'A', after: 'B' }], 'Paste 3 spawns'), where: { map: 0, x: 1, y: 1, z: 1 } };
    expect(describeStep(s)).toMatchObject({ label: 'Paste 3 spawns', where: { map: 0, x: 1, y: 1, z: 1 } });
  });

  it('calls a step of several kinds by the quest part first, then the world', () => {
    const mixed = step([{ kind: 'world', before: EMPTY_WORLD, after: EMPTY_WORLD }, { kind: 'quest', questId: 1, before: edit(1, { [TITLE]: 'T', a: 1 }), after: edit(1, { [TITLE]: 'T', a: 2 }) }]);
    expect(describeStep(mixed).kind).toBe('quest');
  });
});

describe('route labels', () => {
  const route = (over: Record<string, unknown> = {}) => ({ pathId: 801, walkers: 1, original: [], current: [{ x: 1, y: 1, z: 1, rest: {} }], ...over });
  it('names a route by the NPC that walks it', () => {
    expect(describeStep(step([{ kind: 'world', before: EMPTY_WORLD, after: { ...EMPTY_WORLD, routes: [route({ name: 'Stormwind Guard' })] } }])).label).toBe('Route of Stormwind Guard');
  });
  it('names a new path by the NPC whose movement walks it', () => {
    const walking = { guid: 5, entry: 6, name: 'Kobold Vermin', map: 0, addonRow: true, original: { type: 'idle', wander: 0, pathId: null }, current: { type: 'path', wander: 0, pathId: 801 } } as any;
    const both = describeStep(step([{ kind: 'world', before: { ...EMPTY_WORLD, movements: [walking] }, after: { ...EMPTY_WORLD, movements: [walking], routes: [route()] } }]));
    expect(both.label).toBe('Route of Kobold Vermin');
  });
});

describe('describeStep for the project store', () => {
  const hela = { ...newNpc(12000001), name: 'Hela', spawns: [{ ...newSpawn(6000001), map: 0, x: 5, y: 6, z: 7 }] };
  const npcs = (...list: any[]) => ({ ...EMPTY_ENTITIES, npcs: list });
  const part = (before: any, after: any): HistoryPart => ({ kind: 'entities', before, after });

  it('names a new, changed and deleted NPC, and says where it stands', () => {
    expect(describeStep(step([part(EMPTY_ENTITIES, npcs(hela))]))).toEqual({ label: 'New NPC Hela', kind: 'entities', where: { map: 0, x: 5, y: 6, z: 7, spawn: { kind: 'creature', guid: 6000001 } } });
    expect(describeStep(step([part(EMPTY_ENTITIES, npcs({ ...newNpc(12000002) }))])).label).toBe('New NPC');
    expect(describeStep(step([part(npcs(hela), npcs({ ...hela, loot: [{ item: 1, chance: 1, min: 1, max: 1, questOnly: false }] }))])).label).toBe('Loot of Hela');
    expect(describeStep(step([part(npcs(hela), npcs({ ...hela, minLevel: 5, faction: 14 }))])).label).toBe('Edit to Hela');
    expect(describeStep(step([part(npcs(hela), EMPTY_ENTITIES)])).label).toBe('Deleted Hela');
  });

  it('names spawns added, moved and removed', () => {
    const moved = { ...hela, spawns: [{ ...hela.spawns[0], x: 9 }] };
    expect(describeStep(step([part(npcs(hela), npcs(moved))])).label).toBe('Moved Hela');
    expect(describeStep(step([part(npcs(hela), npcs({ ...hela, spawns: [] }))])).label).toBe('Removed a spawn of Hela');
    expect(describeStep(step([part(npcs(hela), npcs({ ...hela, spawns: [...hela.spawns, newSpawn(6000002)] }))])).label).toBe('Placed Hela');
  });

  it('names objects as objects, and several changes by count', () => {
    const crate = { ...newObject(9100001), name: 'Crate' };
    expect(describeStep(step([part(EMPTY_ENTITIES, { ...EMPTY_ENTITIES, objects: [crate] })])).label).toBe('New object Crate');
    expect(describeStep(step([part(EMPTY_ENTITIES, { ...EMPTY_ENTITIES, npcs: [hela], objects: [crate] })])).label).toBe('NPCs and objects: 2 changes');
  });
});

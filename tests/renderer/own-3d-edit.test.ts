import { describe, expect, it } from 'vitest';
import { ENTITIES_FIELD, newNpc, newObject, newSpawn, readEntities, writeEntities } from '../../src/core/entities/model';
import { ownEdit } from '../../src/renderer/map/own-3d-edit';

const values = () => ({
  [ENTITIES_FIELD]: writeEntities({
    npcs: [{ ...newNpc(12000001), name: 'Hela', spawns: [{ ...newSpawn(900), map: 0, x: 1, y: 1, z: 1 }] }],
    objects: [{ ...newObject(13000001), name: 'Crate', spawns: [] }],
    items: [],
  }),
});
const npcRef = (guid: number) => ({ kind: 'creature' as const, guid, entry: 12000001, own: true });
const read = (edit: { value: unknown } | null) => readEntities({ [ENTITIES_FIELD]: edit!.value });
const at = { x: 5, y: 6, z: 7, orientation: 1, rotation: null };

describe('3D edits to the quest’s own spawns', () => {
  it('adds a spawn of an own NPC, and takes it away again', () => {
    const added = ownEdit(values(), { kind: 'presence', spawn: npcRef(901), present: true, at, map: 0 });
    expect(read(added).npcs[0]!.spawns.map((s) => [s.guid, s.x, s.o])).toEqual([[900, 1, 0], [901, 5, 1]]);
    const removed = ownEdit({ [ENTITIES_FIELD]: added!.value }, { kind: 'presence', spawn: npcRef(901), present: false, at, map: 0 });
    expect(read(removed).npcs[0]!.spawns.map((s) => s.guid)).toEqual([900]);
  });

  it('adds a spawn of an own object with its rotation', () => {
    const edit = ownEdit(values(), { kind: 'presence', spawn: { kind: 'object', guid: 950, entry: 13000001, own: true }, present: true, at: { ...at, rotation: [0, 0, 0.5, 0.8660254] }, map: 0 });
    expect(read(edit).objects[0]!.spawns[0]).toMatchObject({ guid: 950, x: 5, rotation: [0, 0, 0.5, 0.8660254] });
  });

  it('sets wander, and clears a patrol when the NPC no longer walks one', () => {
    const wander = ownEdit(values(), { kind: 'movement', spawn: npcRef(900), to: { type: 'wander', wander: 6, pathId: null } });
    expect(read(wander).npcs[0]!.spawns[0]).toMatchObject({ wander: 6, patrol: null });
  });

  it('starts a patrol on a path movement, and a route edit fills it', () => {
    const started = ownEdit(values(), { kind: 'movement', spawn: npcRef(900), to: { type: 'path', wander: 0, pathId: 9000 } });
    expect(read(started).npcs[0]!.spawns[0]).toMatchObject({ wander: 0, patrol: { pathId: 9000, points: [] } });
    const filled = ownEdit({ [ENTITIES_FIELD]: started!.value }, { kind: 'route', spawn: npcRef(900), pathId: 9000, points: [{ x: 2, y: 2, z: 2 }, { x: 3, y: 3, z: 3 }] });
    expect(read(filled).npcs[0]!.spawns[0]!.patrol!.points.map((p) => p.x)).toEqual([2, 3]);
  });

  it('a route edit for an NPC with no patrol creates one with that path id', () => {
    const edit = ownEdit(values(), { kind: 'route', spawn: npcRef(900), pathId: 9001, points: [{ x: 2, y: 2, z: 2 }] });
    expect(read(edit).npcs[0]!.spawns[0]!.patrol).toMatchObject({ pathId: 9001, points: [{ x: 2 }] });
  });

  it('is null for a spawn the quest does not have', () => {
    expect(ownEdit(values(), { kind: 'movement', spawn: npcRef(4242), to: { type: 'idle', wander: 0, pathId: null } })).toBeNull();
  });
});

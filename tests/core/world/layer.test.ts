import { describe, expect, it } from 'vitest';
import {
  EMPTY_WORLD, NEW_POINT_REST, addSpawn, hasWorldChanges, isAdded, moveSpawn, movementsOf, respawnsOf, revertMovement, revertRespawn, revertRoute, revertSpawn, setMovement, setRespawn, setRoute, worldStatements,
  type Placement, type RoutePoint, type WorldAddedSpawn, type WorldMovementEdit, type WorldSpawnEdit,
} from '../../../src/core/world/layer';
import { IDLE } from '../../../src/core/world/movement';

const at = (x: number, over: Partial<Placement> = {}): Placement => ({ x, y: 2, z: 3, orientation: 0.5, rotation: null, ...over });
const guard: Omit<WorldSpawnEdit, 'current'> = { kind: 'creature', guid: 80330, entry: 1423, name: 'Stormwind Guard', map: 0, original: at(1) };
const mailbox: Omit<WorldSpawnEdit, 'current'> = { kind: 'gameobject', guid: 5, entry: 143981, name: 'Mailbox', map: 0, original: at(10, { rotation: [0, 0, 0, 1] }) };
const point = (x: number, rest: Record<string, string | null> = { orientation: null, delay: '5000', move_type: '0', action: '7', action_chance: '100', wpguid: '0' }): RoutePoint => ({ x, y: 0, z: 1, rest });
const route = { pathId: 801, walkers: 2, original: [point(1), point(2)] };

describe('world layer: spawns', () => {
  it('records the original at the first move and keeps it through later ones', () => {
    let layer = moveSpawn(EMPTY_WORLD, guard, at(5));
    layer = moveSpawn(layer, { ...guard, original: at(5) }, at(6));
    expect(layer.spawns).toEqual([{ ...guard, current: at(6) }]);
    expect(EMPTY_WORLD.spawns).toEqual([]);
  });

  it('drops an entry moved back to its original', () => {
    const layer = moveSpawn(moveSpawn(EMPTY_WORLD, guard, at(5)), guard, at(1));
    expect(layer.spawns).toEqual([]);
  });

  it('keeps creatures and objects with the same guid apart, and reverts one', () => {
    let layer = moveSpawn(EMPTY_WORLD, guard, at(5));
    layer = moveSpawn(layer, { ...mailbox, guid: 80330 }, at(11, { rotation: [0, 0, 1, 0] }));
    expect(layer.spawns).toHaveLength(2);
    layer = revertSpawn(layer, 'gameobject', 80330);
    expect(layer.spawns.map((s) => s.kind)).toEqual(['creature']);
  });
});

describe('world layer: what the 3D view sends back', () => {
  it('drops an NPC put back where it was, though its facing came back through a quaternion', () => {
    const npc = { ...guard, original: at(1, { orientation: 3.9 }) };
    const layer = moveSpawn(moveSpawn(EMPTY_WORLD, npc, at(5, { orientation: 3.9 })), npc, at(1.00000001, { orientation: 3.8999999999999995 }));
    expect(layer.spawns).toEqual([]);
  });

  it('drops an object put back where it was, its rotation the same turn written the other way round', () => {
    const box = { ...mailbox, original: at(10, { orientation: 1, rotation: [0, 0, 0.5, 0.8660254] }) };
    const layer = moveSpawn(moveSpawn(EMPTY_WORLD, box, at(12, { orientation: 1, rotation: [0, 0, 0.5, 0.8660254] })), box, at(10, { orientation: 1.0471975, rotation: [-0, -0, -0.5, -0.8660254] }));
    expect(layer.spawns).toEqual([]);
  });

  it('keeps the stored facing of an object only moved, even one stored with no rotation (drawn upright)', () => {
    const old = { ...mailbox, original: at(10, { orientation: 2.5, rotation: [0, 0, 0, 0] }) };
    const layer = moveSpawn(EMPTY_WORLD, old, at(14, { orientation: 0, rotation: [0, 0, 0, 1] }));
    expect(layer.spawns[0]!.current).toEqual(at(14, { orientation: 2.5, rotation: [0, 0, 0, 0] }));
  });

  it('keeps the stored facing of an NPC only moved', () => {
    const npc = { ...guard, original: at(1, { orientation: 0.0174533 }) };
    const layer = moveSpawn(EMPTY_WORLD, npc, at(9, { orientation: 0.017453299999999998 }));
    expect(layer.spawns[0]!.current.orientation).toBe(0.0174533);
  });

  it('takes a real turn as it is', () => {
    const layer = moveSpawn(EMPTY_WORLD, { ...guard, original: at(1, { orientation: 1 }) }, at(1, { orientation: 2 }));
    expect(layer.spawns[0]!.current.orientation).toBe(2);
  });
});

describe('world layer: routes', () => {
  it('records the original route and walkers at the first edit, and drops it when put back', () => {
    let layer = setRoute(EMPTY_WORLD, route, [point(1), point(9), point(2)]);
    expect(layer.routes).toEqual([{ ...route, current: [point(1), point(9), point(2)] }]);
    layer = setRoute(layer, { ...route, original: [point(7)] }, [point(1), point(2)]);
    expect(layer.routes).toEqual([]);
  });

  it('reverts a route', () => {
    const layer = revertRoute(setRoute(EMPTY_WORLD, route, [point(3), point(4)]), 801);
    expect(layer.routes).toEqual([]);
  });
});

describe('world layer: statements', () => {
  it('updates a creature by guid, without rotation, and reverts to the original', () => {
    const { apply, revert } = worldStatements(moveSpawn(EMPTY_WORLD, guard, at(-9481.31, { orientation: 1.25 })));
    expect(apply).toEqual([{ kind: 'update', table: 'creature', key: { guid: '80330' }, set: { position_x: '-9481.31', position_y: '2', position_z: '3', orientation: '1.25' } }]);
    expect(revert).toEqual([{ kind: 'update', table: 'creature', key: { guid: '80330' }, set: { position_x: '1', position_y: '2', position_z: '3', orientation: '0.5' } }]);
  });

  it('updates an object with its rotation', () => {
    const { apply } = worldStatements(moveSpawn(EMPTY_WORLD, mailbox, at(12, { rotation: [0, 0, 0.5, 0.8660254] })));
    expect(apply[0]).toEqual({
      kind: 'update', table: 'gameobject', key: { guid: '5' },
      set: { position_x: '12', position_y: '2', position_z: '3', orientation: '0.5', rotation0: '0', rotation1: '0', rotation2: '0.5', rotation3: '0.8660254' },
    });
  });

  it('keeps each point\'s other columns and numbers points from 1, giving new points the defaults', () => {
    const fresh = { x: 5, y: 0, z: 1, rest: {} };
    const { apply, revert } = worldStatements(setRoute(EMPTY_WORLD, route, [point(1), fresh, point(2, { orientation: '1', delay: '0', move_type: '1', action: '0', action_chance: '50', wpguid: '0' })]));
    expect(apply).toEqual([
      { kind: 'delete', table: 'waypoint_data', key: { id: '801' } },
      { kind: 'insert', table: 'waypoint_data', row: { id: '801', point: '1', position_x: '1', position_y: '0', position_z: '1', orientation: null, delay: '5000', move_type: '0', action: '7', action_chance: '100', wpguid: '0' } },
      { kind: 'insert', table: 'waypoint_data', row: { id: '801', point: '2', position_x: '5', position_y: '0', position_z: '1', ...NEW_POINT_REST } },
      { kind: 'insert', table: 'waypoint_data', row: { id: '801', point: '3', position_x: '2', position_y: '0', position_z: '1', orientation: '1', delay: '0', move_type: '1', action: '0', action_chance: '50', wpguid: '0' } },
    ]);
    expect(revert.filter((s) => s.kind === 'insert')).toHaveLength(2);
    expect(revert[0]).toEqual({ kind: 'delete', table: 'waypoint_data', key: { id: '801' } });
  });

  it('fills every column the database has under a point, and leaves out defaults it does not have', () => {
    const fresh = { x: 5, y: 0, z: 1, rest: {} };
    const defaults = { id: '0', point: '0', position_x: '0', position_y: '0', position_z: '0', orientation: null, velocity: '0', delay: '0', move_type: '0', action: '0', action_chance: '100' };
    const { apply } = worldStatements(setRoute(EMPTY_WORLD, route, [point(1), fresh]), defaults);
    expect(apply[2]).toEqual({ kind: 'insert', table: 'waypoint_data', row: { id: '801', point: '2', position_x: '5', position_y: '0', position_z: '1', orientation: null, velocity: '0', delay: '0', move_type: '0', action: '0', action_chance: '100' } });
  });

  it('has nothing to write for an empty layer', () => {
    expect(worldStatements(EMPTY_WORLD)).toEqual({ apply: [], revert: [] });
  });
});

describe('world layer: placed spawns', () => {
  const look = { displayId: 3167, scale: 1, equipment: [0, 0, 0] as [number, number, number], preset: null };
  const placedGuard: WorldAddedSpawn = { kind: 'creature', guid: 90001, entry: 1423, name: 'Stormwind Guard', map: 0, placement: at(7, { orientation: 1 }), look: { ...look, equipment: [1, 0, 0] } };
  const placedTent: WorldAddedSpawn = { kind: 'gameobject', guid: 90002, entry: 2000, name: 'Tent', map: 0, placement: at(9, { orientation: 0, rotation: null }), look: { ...look, scale: 1.5 } };
  const creatureColumns = { guid: '0', id: '0', id1: '0', map: '0', spawnMask: '1', phaseMask: '1', equipment_id: '0', position_x: '0', position_y: '0', position_z: '0', orientation: '0', spawntimesecs: '120', wander_distance: '0', MovementType: '0', Comment: null };
  const objectColumns = { guid: '0', id: '0', map: '0', spawnMask: '1', phaseMask: '1', position_x: '0', position_y: '0', position_z: '0', orientation: '0', rotation0: '0', rotation1: '0', rotation2: '0', rotation3: '1', spawntimesecs: '0', animprogress: '0', state: '0', Comment: null };

  it('counts as a change, and is told apart from a database spawn', () => {
    const layer = addSpawn(EMPTY_WORLD, placedGuard);
    expect(hasWorldChanges(layer)).toBe(true);
    expect(hasWorldChanges(EMPTY_WORLD)).toBe(false);
    expect([isAdded(layer, 'creature', 90001), isAdded(layer, 'gameobject', 90001), isAdded(layer, 'creature', 1)]).toEqual([true, false, false]);
    expect(EMPTY_WORLD.added).toEqual([]);
  });

  it('moves where it stands without keeping an original, and is taken back by a revert', () => {
    let layer = addSpawn(EMPTY_WORLD, placedGuard);
    layer = moveSpawn(layer, { kind: 'creature', guid: 90001, entry: 1423, name: 'Stormwind Guard', map: 0, original: placedGuard.placement }, at(20, { orientation: 2 }));
    expect(layer.spawns).toEqual([]);
    expect(layer.added[0]!.placement).toEqual(at(20, { orientation: 2 }));
    expect(revertSpawn(layer, 'creature', 90001).added).toEqual([]);
  });

  it('writes an NPC as a row of the database\'s own columns, whichever it calls its entry, and removes it by guid', () => {
    const { apply, revert } = worldStatements(addSpawn(EMPTY_WORLD, placedGuard), undefined, { creature: creatureColumns });
    expect(apply).toEqual([
      { kind: 'delete', table: 'creature', key: { guid: '90001' } },
      { kind: 'insert', table: 'creature', row: { ...creatureColumns, guid: '90001', id: '1423', id1: '1423', map: '0', equipment_id: '1', position_x: '7', position_y: '2', position_z: '3', orientation: '1', spawntimesecs: '300', Comment: 'ACQC 3D view' } },
    ]);
    expect(revert).toEqual([{ kind: 'delete', table: 'creature', key: { guid: '90001' } }]);
    // A fork with `id` only has no `id1` written
    const { id1: _id1, ...forked } = creatureColumns;
    const row = (worldStatements(addSpawn(EMPTY_WORLD, placedGuard), undefined, { creature: forked }).apply[1] as { row: Record<string, string | null> }).row;
    expect('id1' in row).toBe(false);
    expect(row.id).toBe('1423');
  });

  it('writes an object turned about Z by its facing, or with the whole rotation the view gave it', () => {
    const turned = addSpawn(EMPTY_WORLD, { ...placedTent, placement: at(9, { orientation: 1, rotation: null }) });
    const row = (worldStatements(turned, undefined, { gameobject: objectColumns }).apply[1] as { row: Record<string, string | null> }).row;
    expect(row).toMatchObject({ id: '2000', rotation0: '0', rotation1: '0', rotation2: '0.479426', rotation3: '0.877583', animprogress: '100', state: '1', spawntimesecs: '300' });
    const tilted = addSpawn(EMPTY_WORLD, { ...placedTent, placement: at(9, { rotation: [0.5, 0, 0, 0.8660254] }) });
    expect((worldStatements(tilted, undefined, { gameobject: objectColumns }).apply[1] as { row: Record<string, string | null> }).row).toMatchObject({ rotation0: '0.5', rotation3: '0.866025' });
  });

  it('says so when the columns of the table are not known, instead of writing a partial row', () => {
    expect(() => worldStatements(addSpawn(EMPTY_WORLD, placedGuard))).toThrow(/creature table's columns/);
  });
});

const walker: Omit<WorldMovementEdit, 'current'> = { guid: 80330, entry: 1423, name: 'Stormwind Guard', map: 0, addonRow: true, original: { type: 'path', wander: 0, pathId: 801 } };
const stander: Omit<WorldMovementEdit, 'current'> = { guid: 80331, entry: 1423, name: 'Stormwind Guard', map: 0, addonRow: false, original: IDLE };
const placedNpc: WorldAddedSpawn = { kind: 'creature', guid: 90001, entry: 1423, name: 'Guard', map: 0, placement: at(1), look: { displayId: 1, scale: 1, equipment: [0, 0, 0], preset: null } };

describe('world layer: movement', () => {
  it('records the original at the first change, keeps it, and drops an entry put back', () => {
    let layer = setMovement(EMPTY_WORLD, stander, { type: 'wander', wander: 5, pathId: null });
    layer = setMovement(layer, { ...stander, original: { type: 'wander', wander: 5, pathId: null } }, { type: 'wander', wander: 8, pathId: null });
    expect(movementsOf(layer)).toEqual([{ ...stander, current: { type: 'wander', wander: 8, pathId: null } }]);
    expect(movementsOf(setMovement(layer, stander, IDLE))).toEqual([]);
    expect(hasWorldChanges(layer)).toBe(true);
  });

  it('reads a layer saved before movements as having none', () => {
    expect(movementsOf({ spawns: [], routes: [], added: [] })).toEqual([]);
  });

  it('reverts one NPC’s movement', () => {
    const layer = setMovement(setMovement(EMPTY_WORLD, stander, { type: 'wander', wander: 3, pathId: null }), walker, IDLE);
    expect(movementsOf(revertMovement(layer, 80331)).map((m) => m.guid)).toEqual([80330]);
  });

  it('a revert of a placed spawn drops its movement and the route made for it', () => {
    let layer = addSpawn(EMPTY_WORLD, placedNpc);
    layer = setMovement(layer, { guid: 90001, entry: 1423, name: 'Guard', map: 0, addonRow: false, original: IDLE }, { type: 'path', wander: 0, pathId: 900010 });
    layer = setRoute(layer, { pathId: 900010, walkers: 1, original: [] }, [point(1), point(2)]);
    const reverted = revertSpawn(layer, 'creature', 90001);
    expect(movementsOf(reverted)).toEqual([]);
    expect(reverted.routes).toEqual([]);
  });

  it('writes wander and movement type, and the revert puts them back', () => {
    const layer = setMovement(EMPTY_WORLD, stander, { type: 'wander', wander: 5, pathId: null });
    const { apply, revert } = worldStatements(layer);
    expect(apply).toEqual([{ kind: 'update', table: 'creature', key: { guid: '80331' }, set: { wander_distance: '5', MovementType: '1' } }]);
    expect(revert).toEqual([{ kind: 'update', table: 'creature', key: { guid: '80331' }, set: { wander_distance: '0', MovementType: '0' } }]);
  });

  it('updates the addon’s path when the spawn has an addon row', () => {
    const layer = setMovement(EMPTY_WORLD, walker, IDLE);
    const { apply, revert } = worldStatements(layer);
    expect(apply).toContainEqual({ kind: 'update', table: 'creature_addon', key: { guid: '80330' }, set: { path_id: '0' } });
    expect(revert).toContainEqual({ kind: 'update', table: 'creature_addon', key: { guid: '80330' }, set: { path_id: '801' } });
  });

  it('inserts an addon row over the table’s defaults when the spawn has none, and the revert deletes it', () => {
    const layer = setMovement(EMPTY_WORLD, stander, { type: 'path', wander: 0, pathId: 803310 });
    const { apply, revert } = worldStatements(layer, undefined, {}, { guid: '0', path_id: '0', bytes1: '0', auras: null });
    expect(apply).toEqual([
      { kind: 'update', table: 'creature', key: { guid: '80331' }, set: { wander_distance: '0', MovementType: '2' } },
      { kind: 'delete', table: 'creature_addon', key: { guid: '80331' } },
      { kind: 'insert', table: 'creature_addon', row: { guid: '80331', path_id: '803310', bytes1: '0', auras: null } },
    ]);
    expect(revert).toEqual([
      { kind: 'update', table: 'creature', key: { guid: '80331' }, set: { wander_distance: '0', MovementType: '0' } },
      { kind: 'delete', table: 'creature_addon', key: { guid: '80331' } },
    ]);
  });

  it('writes movements after placed spawns and before routes', () => {
    let layer = addSpawn(EMPTY_WORLD, placedNpc);
    layer = setMovement(layer, { guid: 90001, entry: 1423, name: 'Guard', map: 0, addonRow: false, original: IDLE }, { type: 'path', wander: 0, pathId: 900010 });
    layer = setRoute(layer, { pathId: 900010, walkers: 1, original: [] }, [point(1), point(2)]);
    const { apply } = worldStatements(layer, undefined, { creature: { guid: null, id1: null, map: null } });
    expect(apply.map((s) => s.table)).toEqual(['creature', 'creature', 'creature', 'creature_addon', 'creature_addon', 'waypoint_data', 'waypoint_data', 'waypoint_data']);
  });
});

describe('world layer: movement keeps what the database had', () => {
  it('seeds a new addon row from the template addon, so its mount and auras stay', () => {
    const layer = setMovement(EMPTY_WORLD, { ...stander, addonSeed: { mount: '2410', bytes1: '1', auras: '1234' } }, { type: 'path', wander: 0, pathId: 803310 });
    const { apply } = worldStatements(layer, undefined, {}, { guid: '0', path_id: '0', mount: '0', bytes1: '0', auras: null });
    expect(apply).toContainEqual({ kind: 'insert', table: 'creature_addon', row: { guid: '80331', path_id: '803310', mount: '2410', bytes1: '1', auras: '1234' } });
  });

  it('puts back the wander distance and movement type the database had, not the normalised ones', () => {
    const layer = setMovement(EMPTY_WORLD, { ...stander, originalRaw: { wander: 5, type: 0 } }, { type: 'path', wander: 0, pathId: 803310 });
    const { revert } = worldStatements(layer);
    expect(revert[0]).toEqual({ kind: 'update', table: 'creature', key: { guid: '80331' }, set: { wander_distance: '5', MovementType: '0' } });
  });
});

describe('world layer: a new path and the movement that walks it', () => {
  const walksNew = (layer: ReturnType<typeof setMovement>) =>
    setRoute(setMovement(layer, stander, { type: 'path', wander: 0, pathId: 803310 }), { pathId: 803310, walkers: 1, original: [] }, [point(1), point(2)]);

  it('reverting the movement takes its new path with it', () => {
    const reverted = revertMovement(walksNew(EMPTY_WORLD), 80331);
    expect(reverted.routes).toEqual([]);
  });

  it('reverting the new path takes back the movement that walks it', () => {
    const reverted = revertRoute(walksNew(EMPTY_WORLD), 803310);
    expect(movementsOf(reverted)).toEqual([]);
  });

  it('reverting an existing route leaves movements alone', () => {
    const layer = setRoute(setMovement(EMPTY_WORLD, walker, { type: 'wander', wander: 3, pathId: 801 }), route, [point(5), point(6)]);
    expect(movementsOf(revertRoute(layer, 801))).toHaveLength(1);
  });
});

describe('respawn time', () => {
  const edit = { kind: 'creature' as const, guid: 80330, entry: 1423, name: 'Stormwind Guard', map: 0, original: 300 };
  it('keeps the first original, and drops an edit set back to it', () => {
    const once = setRespawn(EMPTY_WORLD, edit, 60);
    expect(respawnsOf(once)).toEqual([{ ...edit, current: 60 }]);
    const twice = setRespawn(once, { ...edit, original: 999 }, 120);
    expect(respawnsOf(twice)).toEqual([{ ...edit, current: 120 }]);
    expect(respawnsOf(setRespawn(twice, edit, 300))).toEqual([]);
  });

  it("sets a placed spawn's own respawn instead of an edit", () => {
    const look = { displayId: 1, scale: 1, equipment: [0, 0, 0] as [number, number, number], preset: null };
    const placed = addSpawn(EMPTY_WORLD, { kind: 'creature', guid: 9, entry: 1423, name: 'G', map: 0, placement: { x: 0, y: 0, z: 0, orientation: 0, rotation: null }, look });
    const next = setRespawn(placed, { ...edit, guid: 9 }, 45);
    expect(next.added[0]!.respawnSecs).toBe(45);
    expect(respawnsOf(next)).toEqual([]);
  });

  it('writes respawn edits as updates, put back by the revert, and a placed spawn with its own time', () => {
    const look = { displayId: 1, scale: 1, equipment: [0, 0, 0] as [number, number, number], preset: null };
    const layer = setRespawn(addSpawn(EMPTY_WORLD, { kind: 'gameobject', guid: 9, entry: 2843, name: 'Chest', map: 0, placement: { x: 0, y: 0, z: 0, orientation: 0, rotation: null }, look, respawnSecs: 30 }), edit, 60);
    const { apply, revert } = worldStatements(layer, undefined, { gameobject: { guid: null, id: null, map: null, spawntimesecs: null } });
    expect(apply).toContainEqual({ kind: 'update', table: 'creature', key: { guid: '80330' }, set: { spawntimesecs: '60' } });
    expect(revert).toContainEqual({ kind: 'update', table: 'creature', key: { guid: '80330' }, set: { spawntimesecs: '300' } });
    expect((apply.find((s) => s.kind === 'insert' && s.table === 'gameobject') as any).row.spawntimesecs).toBe('30');
    expect(hasWorldChanges({ ...EMPTY_WORLD, respawns: [{ ...edit, current: 60 }] })).toBe(true);
    expect(respawnsOf(revertRespawn(layer, 'creature', 80330))).toEqual([]);
  });
});

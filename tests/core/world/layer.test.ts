import { describe, expect, it } from 'vitest';
import {
  EMPTY_WORLD, NEW_POINT_REST, addSpawn, deleteGroup, deleteSpawn, withoutDeletedMembers, deletesOf, isDeleted, revertDelete, dropMember, groupsOf, hasWorldChanges, isAdded, moveSpawn, movementsOf, putGroup, respawnsOf, revertGroup, revertMovement, revertRespawn, revertRoute, revertSpawn, revertSpawnEvents, setMovement, setRespawn, setRoute, setSpawnEvents, spawnEventsOf, worldStatements,
  type Placement, type RoutePoint, type WorldAddedSpawn, type WorldDeletedSpawn, type WorldMovementEdit, type WorldSpawnEdit,
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

describe('spawn groups in the layer', () => {
  const drake = { type: 'spawn' as const, kind: 'npc' as const, guid: 39203, entry: 32491, chance: 10 };
  const vyragosa = { type: 'spawn' as const, kind: 'npc' as const, guid: 39207, entry: 32630, chance: 0 };
  const fresh = { id: 900001, name: 'Path 1', map: 571, maxActive: 1, event: null, members: [drake, vyragosa], origin: { kind: 'new' as const } };
  const original = {
    template: { entry: '32492', max_limit: '1', description: 'Path 1' },
    members: [
      { table: 'pool_creature' as const, row: { guid: '39203', pool_entry: '32492', chance: '10', description: 'Path 1' } },
      { table: 'pool_creature' as const, row: { guid: '39207', pool_entry: '32492', chance: '0', description: 'Path 1' } },
    ],
    event: null,
  };
  const existing = { ...fresh, id: 32492, origin: { kind: 'existing' as const, original } };

  it('puts, replaces and reverts a group; deleting a new one forgets it, an existing one is kept as removed', () => {
    const one = putGroup(EMPTY_WORLD, fresh);
    expect(groupsOf(putGroup(one, { ...fresh, maxActive: 2 }))).toEqual([{ ...fresh, maxActive: 2 }]);
    expect(groupsOf(deleteGroup(one, fresh))).toEqual([]);
    expect(groupsOf(deleteGroup(EMPTY_WORLD, existing))).toEqual([{ ...existing, removed: true }]);
    expect(groupsOf(revertGroup(one, 900001))).toEqual([]);
    expect(hasWorldChanges(one)).toBe(true);
  });

  it('dropping a spawn takes it out of its groups, and a new group left empty goes', () => {
    const one = putGroup(EMPTY_WORLD, { ...fresh, members: [drake] });
    expect(groupsOf(dropMember(one, 'npc', 39203))).toEqual([]);
    const two = putGroup(EMPTY_WORLD, existing);
    expect(groupsOf(dropMember(two, 'npc', 39203))[0]!.members).toEqual([vyragosa]);
  });

  it('writes a new group with its members, and the revert takes them away', () => {
    const mother = { id: 900002, name: 'Drake', map: 571, maxActive: 1, event: null, members: [{ type: 'group' as const, id: 900001, chance: 0 }], origin: { kind: 'new' as const } };
    const { apply, revert } = worldStatements(putGroup(putGroup(EMPTY_WORLD, fresh), mother));
    expect(apply).toEqual(expect.arrayContaining([
      { kind: 'delete', table: 'pool_template', key: { entry: '900001' } },
      { kind: 'delete', table: 'pool_creature', key: { pool_entry: '900001' } },
      { kind: 'insert', table: 'pool_template', row: { entry: '900001', max_limit: '1', description: 'Path 1' } },
      { kind: 'insert', table: 'pool_creature', row: { guid: '39203', pool_entry: '900001', chance: '10', description: 'Path 1' } },
      { kind: 'insert', table: 'pool_creature', row: { guid: '39207', pool_entry: '900001', chance: '0', description: 'Path 1' } },
      { kind: 'insert', table: 'pool_pool', row: { pool_id: '900001', mother_pool: '900002', chance: '0', description: 'Drake' } },
    ]));
    expect(revert).toEqual(expect.arrayContaining([
      { kind: 'delete', table: 'pool_template', key: { entry: '900001' } },
      { kind: 'delete', table: 'pool_pool', key: { mother_pool: '900002' } },
    ]));
    expect(revert.some((s) => s.kind === 'insert')).toBe(false);
  });

  it('an edited existing group is rewritten and its original rows come back on revert; a removed one only goes', () => {
    const edited = worldStatements(putGroup(EMPTY_WORLD, { ...existing, members: [{ ...drake, chance: 50 }, { ...vyragosa, chance: 50 }] }));
    expect(edited.apply).toContainEqual({ kind: 'insert', table: 'pool_creature', row: { guid: '39203', pool_entry: '32492', chance: '50', description: 'Path 1' } });
    expect(edited.revert).toEqual(expect.arrayContaining([
      { kind: 'insert', table: 'pool_template', row: original.template },
      { kind: 'insert', table: 'pool_creature', row: original.members[0]!.row },
    ]));
    const removed = worldStatements(deleteGroup(EMPTY_WORLD, existing));
    expect(removed.apply.some((s) => s.kind === 'insert')).toBe(false);
    expect(removed.apply).toContainEqual({ kind: 'delete', table: 'pool_template', key: { entry: '32492' } });
    expect(removed.revert).toContainEqual({ kind: 'insert', table: 'pool_template', row: original.template });
  });

  /** A tiny pool database that refuses a second row with the same primary key, as the server does */
  function runPools(start: { table: string; row: Record<string, string | null> }[], statements: { kind: string; table: string; key?: Record<string, string>; row?: Record<string, string | null> }[]) {
    const pk: Record<string, string> = { pool_template: 'entry', pool_creature: 'guid', pool_gameobject: 'guid', pool_pool: 'pool_id' };
    let rows = start.map((r) => ({ ...r }));
    for (const s of statements) {
      if (!(s.table in pk)) continue;
      if (s.kind === 'delete') rows = rows.filter((r) => !(r.table === s.table && Object.entries(s.key!).every(([c, v]) => r.row[c] === v)));
      else if (s.kind === 'insert') {
        const k = pk[s.table]!;
        if (rows.some((r) => r.table === s.table && r.row[k] === s.row![k])) throw new Error(`Duplicate entry '${s.row![k]}' for key ${s.table}.PRIMARY`);
        rows.push({ table: s.table, row: s.row! });
      }
    }
    return rows;
  }

  it('moving a spawn from an existing group into another applies and reverts without a duplicate key, in either order', () => {
    const db = [{ table: 'pool_template', row: original.template }, ...original.members];
    const left = { ...existing, members: [vyragosa], maxActive: 1 };
    const taker = { ...fresh, members: [drake] };
    for (const layer of [putGroup(putGroup(EMPTY_WORLD, left), taker), putGroup(putGroup(EMPTY_WORLD, taker), left)]) {
      const { apply, revert } = worldStatements(layer);
      const after = runPools(db, apply);
      expect(after.filter((r) => r.table === 'pool_creature' && r.row.guid === '39203').map((r) => r.row.pool_entry)).toEqual(['900001']);
      const back = runPools(after, revert);
      expect(back).toEqual(expect.arrayContaining(db));
      expect(back).toHaveLength(db.length);
    }
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

describe('rotations and events in the patch', () => {
  const rotation = { id: 900010, name: 'Dailies', map: 0, maxActive: 1, members: [{ type: 'quest' as const, questId: 60001 }, { type: 'quest' as const, questId: 60002 }], origin: { kind: 'new' as const }, event: null };

  it('writes a new rotation as a template and pool_quest rows, deletes first, and the revert removes them', () => {
    const { apply, revert } = worldStatements(putGroup(EMPTY_WORLD, rotation));
    expect(apply).toEqual(expect.arrayContaining([
      { kind: 'delete', table: 'pool_quest', key: { pool_entry: '900010' } },
      { kind: 'insert', table: 'pool_template', row: { entry: '900010', max_limit: '1', description: 'Dailies' } },
      { kind: 'insert', table: 'pool_quest', row: { entry: '60001', pool_entry: '900010', description: 'Dailies' } },
      { kind: 'insert', table: 'pool_quest', row: { entry: '60002', pool_entry: '900010', description: 'Dailies' } },
    ]));
    const lastDelete = Math.max(...apply.map((s, i) => (s.kind === 'delete' ? i : -1)));
    const firstInsert = apply.findIndex((s) => s.kind === 'insert');
    expect(lastDelete).toBeLessThan(firstInsert);
    expect(revert).toContainEqual({ kind: 'delete', table: 'pool_quest', key: { pool_entry: '900010' } });
  });

  it("writes a new group's event, during as positive and except during as negative", () => {
    const camp = { id: 900020, name: 'Camp', map: 0, maxActive: 1, members: [{ type: 'spawn' as const, kind: 'npc' as const, guid: 1, entry: 1, chance: 0 }], origin: { kind: 'new' as const }, event: { id: 4, during: false } };
    const { apply, revert } = worldStatements(putGroup(EMPTY_WORLD, camp));
    expect(apply).toContainEqual({ kind: 'delete', table: 'game_event_pool', key: { pool_entry: '900020' } });
    expect(apply).toContainEqual({ kind: 'insert', table: 'game_event_pool', row: { eventEntry: '-4', pool_entry: '900020' } });
    expect(revert).toContainEqual({ kind: 'delete', table: 'game_event_pool', key: { pool_entry: '900020' } });
  });

  it("leaves an existing group's event row alone when its event did not change, and puts it back when it did", () => {
    const eventRow = { eventEntry: '12', pool_entry: '32492' };
    const existing = { id: 32492, name: 'Path 1', map: 571, maxActive: 1, members: [{ type: 'spawn' as const, kind: 'npc' as const, guid: 39203, entry: 32491, chance: 0 }],
      origin: { kind: 'existing' as const, original: { template: { entry: '32492', max_limit: '1', description: 'Path 1' }, members: [], event: eventRow } }, event: { id: 12, during: true } };
    const same = worldStatements(putGroup(EMPTY_WORLD, { ...existing, maxActive: 1 }));
    expect([...same.apply, ...same.revert].some((s) => s.table === 'game_event_pool')).toBe(false);
    const changed = worldStatements(putGroup(EMPTY_WORLD, { ...existing, event: null }));
    expect(changed.apply).toContainEqual({ kind: 'delete', table: 'game_event_pool', key: { pool_entry: '32492' } });
    expect(changed.apply.some((s) => s.kind === 'insert' && s.table === 'game_event_pool')).toBe(false);
    expect(changed.revert).toContainEqual({ kind: 'insert', table: 'game_event_pool', row: eventRow });
  });
});

describe("a spawn's events", () => {
  const edit = { guid: 80330, entry: 1423, name: 'Stormwind Guard', map: 0, original: [{ eventEntry: '12', guid: '80330' }] };
  const during4 = { mode: 'during' as const, events: [4] };

  it('keeps the first original; Same as the NPC drops the edit', () => {
    const once = setSpawnEvents(EMPTY_WORLD, edit, during4);
    expect(spawnEventsOf(once)).toEqual([{ ...edit, current: during4 }]);
    const twice = setSpawnEvents(once, { ...edit, original: [] }, null);
    expect(spawnEventsOf(twice)).toEqual([{ ...edit, current: null }]);
    expect(spawnEventsOf(setSpawnEvents(twice, edit, 'npc'))).toEqual([]);
    expect(hasWorldChanges(once)).toBe(true);
    expect(spawnEventsOf(revertSpawnEvents(once, 80330))).toEqual([]);
  });

  it("sets a placed spawn's own events instead of an edit", () => {
    const look = { displayId: 1, scale: 1, equipment: [0, 0, 0] as [number, number, number], preset: null };
    const placed = addSpawn(EMPTY_WORLD, { kind: 'creature', guid: 9, entry: 1423, name: 'G', map: 0, placement: { x: 0, y: 0, z: 0, orientation: 0, rotation: null }, look });
    const next = setSpawnEvents(placed, { ...edit, guid: 9, original: [] }, during4);
    expect(next.added[0]!.events).toEqual(during4);
    expect(spawnEventsOf(next)).toEqual([]);
    expect(setSpawnEvents(next, { ...edit, guid: 9, original: [] }, 'npc').added[0]).not.toHaveProperty('events');
  });

  it('is not written by the world patch: the spawn event writer owns those rows', () => {
    const { apply } = worldStatements(setSpawnEvents(EMPTY_WORLD, edit, during4));
    expect(apply.some((s) => s.table === 'game_event_creature')).toBe(false);
  });
});

describe('deleting a database spawn', () => {
  const gone: WorldDeletedSpawn = {
    kind: 'creature', guid: 80330, entry: 1423, name: 'Stormwind Guard', map: 0, placement: at(1),
    rows: [
      { table: 'creature', row: { guid: '80330', id1: '1423', map: '0' } },
      { table: 'creature_addon', row: { guid: '80330', path_id: '801' } },
      { table: 'game_event_creature', row: { eventEntry: '3', guid: '80330' } },
      { table: 'game_event_creature', row: { eventEntry: '-4', guid: '80330' } },
      { table: 'pool_creature', row: { guid: '80330', pool_entry: '9', chance: '0' } },
    ],
  };
  const crate: WorldDeletedSpawn = { kind: 'gameobject', guid: 5, entry: 143981, name: 'Mailbox', map: 0, placement: at(10), rows: [{ table: 'gameobject', row: { guid: '5', id: '143981' } }] };

  it('records the spawn, leaves the layer it was given alone, and counts as a change', () => {
    const layer = deleteSpawn(EMPTY_WORLD, gone);
    expect(deletesOf(layer)).toEqual([gone]);
    expect(deletesOf(EMPTY_WORLD)).toEqual([]);
    expect(hasWorldChanges(layer)).toBe(true);
  });

  it('keeps creatures and objects with the same guid apart', () => {
    const layer = deleteSpawn(EMPTY_WORLD, { ...crate, guid: 80330 });
    expect(isDeleted(layer, 'gameobject', 80330)).toBe(true);
    expect(isDeleted(layer, 'creature', 80330)).toBe(false);
  });

  it('deleting the same spawn twice keeps one entry', () => {
    const layer = deleteSpawn(deleteSpawn(EMPTY_WORLD, gone), gone);
    expect(deletesOf(layer)).toHaveLength(1);
  });

  it("takes the spawn's other edits with it: move, respawn and movement", () => {
    let layer = moveSpawn(EMPTY_WORLD, guard, at(5));
    layer = setRespawn(layer, { kind: 'creature', guid: 80330, entry: 1423, name: 'Stormwind Guard', map: 0, original: 300 }, 60);
    layer = setMovement(layer, { guid: 80330, entry: 1423, name: 'Stormwind Guard', map: 0, addonRow: true, original: IDLE }, { type: 'wander', wander: 5, pathId: null });
    layer = moveSpawn(layer, mailbox, at(11, { rotation: [0, 0, 0, 1] }));
    const after = deleteSpawn(layer, gone);
    expect(after.spawns.map((s) => s.guid)).toEqual([5]);
    expect(respawnsOf(after)).toEqual([]);
    expect(movementsOf(after)).toEqual([]);
  });

  it("takes the spawn out of the layer's groups", () => {
    const member = { type: 'spawn' as const, kind: 'npc' as const, guid: 80330, entry: 1423, chance: 0 };
    const other = { type: 'spawn' as const, kind: 'npc' as const, guid: 80331, entry: 1423, chance: 0 };
    const layer = putGroup(EMPTY_WORLD, { id: 900001, name: 'Pack', map: 0, maxActive: 1, event: null, members: [member, other], origin: { kind: 'new' } });
    expect(groupsOf(deleteSpawn(layer, gone))[0]!.members).toEqual([other]);
  });

  it('reverting the delete forgets it, and leaves no empty list behind when it was the only one', () => {
    const layer = deleteSpawn(deleteSpawn(EMPTY_WORLD, gone), crate);
    expect(deletesOf(revertDelete(layer, 'creature', 80330))).toEqual([crate]);
    expect(revertDelete(deleteSpawn(EMPTY_WORLD, gone), 'creature', 80330)).toEqual({ spawns: [], routes: [], added: [] });
    expect('deletes' in revertDelete(deleteSpawn(EMPTY_WORLD, gone), 'creature', 80330)).toBe(false);
  });

  it('reads a layer saved before deletes as having none', () => {
    expect(deletesOf({ spawns: [], routes: [], added: [] })).toEqual([]);
    expect(isDeleted({ spawns: [], routes: [], added: [] }, 'creature', 1)).toBe(false);
    expect(worldStatements({ spawns: [], routes: [], added: [] })).toEqual({ apply: [], revert: [] });
  });

  it('writes one DELETE per table by guid, dependents first and the spawn row last, and reverts by deleting then inserting every captured row, the spawn row first', () => {
    const { apply, revert } = worldStatements(deleteSpawn(EMPTY_WORLD, gone));
    expect(apply).toEqual([
      { kind: 'delete', table: 'creature_addon', key: { guid: '80330' } },
      { kind: 'delete', table: 'game_event_creature', key: { guid: '80330' } },
      { kind: 'delete', table: 'pool_creature', key: { guid: '80330' } },
      { kind: 'delete', table: 'creature', key: { guid: '80330' } },
    ]);
    expect(revert).toEqual([
      ...apply,
      { kind: 'insert', table: 'creature', row: { guid: '80330', id1: '1423', map: '0' } },
      { kind: 'insert', table: 'creature_addon', row: { guid: '80330', path_id: '801' } },
      { kind: 'insert', table: 'game_event_creature', row: { eventEntry: '3', guid: '80330' } },
      { kind: 'insert', table: 'game_event_creature', row: { eventEntry: '-4', guid: '80330' } },
      { kind: 'insert', table: 'pool_creature', row: { guid: '80330', pool_entry: '9', chance: '0' } },
    ]);
  });

  it('puts the deletes before every other statement when applying, and the restoring inserts after every other statement when reverting', () => {
    const layer = deleteSpawn(moveSpawn(EMPTY_WORLD, mailbox, at(12, { rotation: [0, 0, 0, 1] })), gone);
    const { apply, revert } = worldStatements(layer);
    expect(apply[0]).toEqual({ kind: 'delete', table: 'creature_addon', key: { guid: '80330' } });
    expect(apply.at(-1)).toMatchObject({ kind: 'update', table: 'gameobject' });
    expect(revert[0]).toMatchObject({ kind: 'update', table: 'gameobject' });
    expect(revert.at(-1)).toEqual({ kind: 'insert', table: 'pool_creature', row: { guid: '80330', pool_entry: '9', chance: '0' } });
  });
});

describe('deleting an NPC that walks a path made in the view', () => {
  const gone: WorldDeletedSpawn = { kind: 'creature', guid: 80330, entry: 1423, name: 'Stormwind Guard', map: 0, placement: at(1), rows: [{ table: 'creature', row: { guid: '80330' } }] };

  it('takes the new path with it, as taking back a placed NPC does, but keeps a path the database has', () => {
    const walking = { guid: 80330, entry: 1423, name: 'Stormwind Guard', map: 0, addonRow: false, original: IDLE };
    let layer = setMovement(EMPTY_WORLD, walking, { type: 'path', wander: 0, pathId: 900801 });
    layer = setRoute(layer, { pathId: 900801, walkers: 1, original: [] }, [point(1), point(2)]);
    layer = setRoute(layer, route, [point(1), point(5)]);
    const after = deleteSpawn(layer, gone);
    expect(movementsOf(after)).toEqual([]);
    expect(after.routes.map((r) => r.pathId)).toEqual([801]);
  });
});

describe("a group read from the database, less the spawns the layer deletes", () => {
  const member = (guid: number) => ({ type: 'spawn' as const, kind: 'npc' as const, guid, entry: 1423, chance: 0 });
  const group = { id: 5000, name: 'Guards', map: 0, maxActive: 1, event: null, members: [member(1), member(2), { type: 'quest' as const, questId: 60001 }], origin: { kind: 'new' as const } };
  const gone = (kind: 'creature' | 'gameobject', guid: number): WorldDeletedSpawn => ({ kind, guid, entry: 1423, name: 'n', map: 0, placement: at(1), rows: [] });

  it('leaves out the deleted NPC and keeps everyone else, by kind', () => {
    const layer = { ...EMPTY_WORLD, deletes: [gone('creature', 1), gone('gameobject', 2)] };
    expect(withoutDeletedMembers(group, layer).members).toEqual([member(2), { type: 'quest', questId: 60001 }]);
  });

  it('is the group itself when nothing in it is deleted', () => {
    expect(withoutDeletedMembers(group, EMPTY_WORLD)).toBe(group);
  });
});

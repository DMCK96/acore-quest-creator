import { describe, expect, it } from 'vitest';
import {
  EMPTY_WORLD, NEW_POINT_REST, addSpawn, hasWorldChanges, isAdded, moveSpawn, revertRoute, revertSpawn, setRoute, worldStatements,
  type Placement, type RoutePoint, type WorldAddedSpawn, type WorldSpawnEdit,
} from '../../../src/core/world/layer';

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

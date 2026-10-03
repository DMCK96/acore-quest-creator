import { describe, expect, it } from 'vitest';
import {
  EMPTY_WORLD, NEW_POINT_REST, moveSpawn, revertRoute, revertSpawn, setRoute, worldStatements,
  type Placement, type RoutePoint, type WorldSpawnEdit,
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

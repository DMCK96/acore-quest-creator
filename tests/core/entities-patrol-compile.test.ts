// tests/core/entities-patrol-compile.test.ts
import { describe, expect, it } from 'vitest';
import { compileEntities } from '../../src/core/entities/compile';
import { EMPTY_ENTITY_CONTEXT } from '../../src/core/entities/context';
import { newNpc, newSpawn, type Patrol } from '../../src/core/entities/model';
import { addAction, addPoint, newPatrol, updatePoint, setStartPace } from '../../src/core/map/patrol';

const Q = 60001;
const three = (): Patrol => {
  let p = addPoint(addPoint(addPoint(newPatrol(9000), { x: 1, y: 2, z: 3 }), { x: 4, y: 5, z: 6 }), { x: 7, y: 8, z: 9 });
  p = updatePoint(p, 1, { waitSecs: 8, facing: 1.25, paceFromHere: 'run' });
  return p;
};
const npcWith = (patrol: Patrol | null, wander = 5) =>
  ({ ...newNpc(12000001), name: 'Hela', displayId: 1, spawns: [{ ...newSpawn(900), wander, patrol }] });
const compile = (patrol: Patrol | null, context = EMPTY_ENTITY_CONTEXT) =>
  compileEntities({ questId: Q, entities: { npcs: [npcWith(patrol)], objects: [] }, givers: [], context });

describe('patrol export', () => {
  it('makes the spawn walk its route', () => {
    const out = compile(three());
    expect(out.inserts.creature![0]).toMatchObject({ guid: '900', MovementType: '2', wander_distance: '0' });
    expect(out.inserts.creature_addon).toEqual([{ guid: '900', path_id: '9000' }]);
    expect(out.inserts.waypoint_data).toEqual([
      { id: '9000', point: '1', position_x: '1', position_y: '2', position_z: '3', delay: '0', move_type: '0', action: '0', action_chance: '100', wpguid: '0', velocity: '0', smoothTransition: '0' },
      { id: '9000', point: '2', position_x: '4', position_y: '5', position_z: '6', orientation: '1.25', delay: '8000', move_type: '0', action: '0', action_chance: '100', wpguid: '0', velocity: '0', smoothTransition: '0' },
      { id: '9000', point: '3', position_x: '7', position_y: '8', position_z: '9', delay: '0', move_type: '1', action: '0', action_chance: '100', wpguid: '0', velocity: '0', smoothTransition: '0' },
    ]);
    expect(out.deletes.creature_addon).toEqual([{ guid: '900' }]);
    expect(out.deletes.waypoint_data).toEqual([{ id: '9000', point: '1' }, { id: '9000', point: '2' }, { id: '9000', point: '3' }]);
  });
  it('starts at the pace it is set to start at', () => {
    expect(compile(setStartPace(three(), 'run')).inserts.waypoint_data![0]!.move_type).toBe('1');
  });
  it('writes no route for fewer than two points, and the spawn wanders as before', () => {
    const out = compile(addPoint(newPatrol(9000), { x: 1, y: 2, z: 3 }));
    expect(out.inserts.creature![0]).toMatchObject({ MovementType: '1', wander_distance: '5' });
    expect(out.inserts.creature_addon).toBeUndefined();
    expect(out.inserts.waypoint_data).toBeUndefined();
  });
  it('deletes the old route of a cleared patrol and the points it no longer has', () => {
    const context = { ...EMPTY_ENTITY_CONTEXT, addons: [{ guid: '900', path_id: '9000' }],
      waypointRows: [{ id: '9000', point: '1' }, { id: '9000', point: '2' }, { id: '9000', point: '3' }, { id: '9000', point: '4' }] };
    const cleared = compile({ ...three(), points: [] }, context);
    expect(cleared.inserts.creature_addon).toBeUndefined();
    expect(cleared.deletes.creature_addon).toEqual([{ guid: '900' }]);
    expect(cleared.deletes.waypoint_data).toHaveLength(4);
    expect(compile(three(), context).deletes.waypoint_data).toContainEqual({ id: '9000', point: '4' });
  });
  it('deletes the addon and route of a spawn removed from the project', () => {
    const context = { ...EMPTY_ENTITY_CONTEXT,
      taggedCreatureSpawns: [{ guid: '905', Comment: 'AQC q60001 npc12000001' }],
      addons: [{ guid: '905', path_id: '9050' }], waypointRows: [{ id: '9050', point: '1' }, { id: '9050', point: '2' }] };
    const out = compile(null, context);
    expect(out.deletes.creature_addon).toEqual([{ guid: '905' }]);
    expect(out.deletes.waypoint_data).toEqual([{ id: '9050', point: '1' }, { id: '9050', point: '2' }]);
  });
  it('never deletes rows of spawns that are not the quest\'s', () => {
    const context = { ...EMPTY_ENTITY_CONTEXT, addons: [{ guid: '77', path_id: '770' }], waypointRows: [{ id: '770', point: '1' }] };
    const out = compile(null, context);
    expect(out.deletes.creature_addon).toBeUndefined();
    expect(out.deletes.waypoint_data).toBeUndefined();
  });
  it('runs an NPC with point actions on SmartAI', () => {
    const p = addAction(three(), 0, { id: 'a1', afterSecs: 0, kind: 'emote', emote: 3 });
    expect(compile(p).inserts.creature_template![0]!.AIName).toBe('SmartAI');
    expect(compile(three()).inserts.creature_template![0]!.AIName).toBe('');
  });
});

import { describe, expect, it } from 'vitest';
import { entityIssues } from '../../src/core/entities/validate';
import { newNpc, newObject, newSpawn } from '../../src/core/entities/model';

const good = { ...newNpc(12000001), name: 'Hela', displayId: 5, spawns: [{ ...newSpawn(1), x: 10 }] };
const codes = (npcs: unknown[], objects: unknown[] = [], dbNames = new Map<string, string>()) =>
  entityIssues({ entities: { npcs: npcs as never, objects: objects as never }, dbNames }).map((i) => [i.code, i.severity]);

describe('entity validation', () => {
  it('accepts a complete NPC', () => expect(codes([good])).toEqual([]));
  it('needs a name and a model', () => expect(codes([{ ...good, name: ' ', displayId: 0 }])).toEqual([['ENTITY_NO_NAME', 'error'], ['ENTITY_NO_MODEL', 'error']]));
  it('checks levels', () => expect(codes([{ ...good, minLevel: 5, maxLevel: 3 }])).toEqual([['ENTITY_LEVELS', 'error']]));
  it('warns about unplaced and unmoved spawns', () => {
    expect(codes([{ ...good, spawns: [] }])).toEqual([['ENTITY_NO_SPAWN', 'warning']]);
    expect(codes([{ ...good, spawns: [newSpawn(1)] }])).toEqual([['ENTITY_SPAWN_ORIGIN', 'warning']]);
  });
  it('warns when the entry already holds something else in the database', () =>
    expect(codes([good], [], new Map([['creature:12000001', 'Someone Else']]))).toEqual([['ENTITY_TAKEN', 'warning']]));
  it('checks objects too', () => expect(codes([], [{ ...newObject(9), name: 'Chest', displayId: 0, spawns: [{ ...newSpawn(2), x: 1 }] }])).toEqual([['ENTITY_NO_MODEL', 'error']]));
  it('warns about patrol point actions with nothing picked', () => {
    const point = (actions: unknown[]) => ({ x: 1, y: 1, z: 1, waitSecs: 0, facing: null, paceFromHere: null, actions });
    const patrol = { pathId: 10, startPace: 'walk', points: [point([]), point([{ id: 'a1', afterSecs: 0, kind: 'mount', creature: 0 }, { id: 'a2', afterSecs: 0, kind: 'say', chance: 100, lines: [{ text: '', style: 'say' }] }])] };
    const issues = entityIssues({ entities: { npcs: [{ ...good, spawns: [{ ...good.spawns[0]!, patrol }] }] as never, objects: [] }, dbNames: new Map() });
    expect(issues.map((i) => [i.code, i.severity, i.message])).toEqual([
      ['PATROL_UNPICKED', 'warning', 'NPC "Hela": at patrol point 2, pick what it rides.'],
      ['PATROL_UNPICKED', 'warning', 'NPC "Hela": at patrol point 2, give it a line to say.'],
    ]);
  });
  it('warns about weapons that are not held in a hand, or not in the database', () => {
    const npc = { ...good, equipment: { mainHand: 1899, offHand: 5, ranged: 777 } };
    const issues = entityIssues({ entities: { npcs: [npc] as never, objects: [] }, dbNames: new Map(), itemInventoryTypes: new Map([[1899, 13], [5, 4]]) });
    expect(issues.map((i) => [i.code, i.severity, i.message])).toEqual([
      ['ENTITY_WEAPON', 'warning', 'NPC "Hela": the off hand item 5 is not held in a hand, so it would not show.'],
      ['ENTITY_WEAPON', 'warning', 'NPC "Hela": the ranged item 777 is not in the world database.'],
    ]);
    expect(entityIssues({ entities: { npcs: [npc] as never, objects: [] }, dbNames: new Map() })).toEqual([]);
  });
});

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
});

import { describe, expect, it } from 'vitest';
import { compileEntities } from '../../src/core/entities/compile';
import { EMPTY_ENTITY_CONTEXT } from '../../src/core/entities/context';
import { ENTITIES_FIELD, newObject, readEntities } from '../../src/core/entities/model';
import { entityIssues } from '../../src/core/entities/validate';

const Q = 60001;
const compile = (objects: ReturnType<typeof newObject>[]) =>
  compileEntities({ questId: Q, entities: { npcs: [], objects }, givers: [], context: EMPTY_ENTITY_CONTEXT });

describe('pages and quest-only objects', () => {
  it('reads an object saved before pages existed', () => {
    const old = { entry: 5, name: 'Note', type: 'text', displayId: 1, size: 1, spawns: [] };
    expect(readEntities({ [ENTITIES_FIELD]: { npcs: [], objects: [old] } as never }).objects[0]).toMatchObject({ pages: [], onlyDuringQuest: false });
  });
  it('writes pages as a chain and points a readable object at the first', () => {
    const note = { ...newObject(9100001), type: 'text' as const, name: 'Note', displayId: 1, pages: [{ id: 5001, text: 'First.' }, { id: 5002, text: 'Second.' }] };
    const out = compile([note]);
    expect(out.inserts.page_text).toEqual([{ ID: '5001', Text: 'First.', NextPageID: '5002' }, { ID: '5002', Text: 'Second.', NextPageID: '0' }]);
    expect(out.deletes.page_text).toEqual([{ ID: '5001' }, { ID: '5002' }]);
    expect(out.inserts.gameobject_template![0]).toMatchObject({ type: '9', Data0: '5001' });
  });
  it('limits a usable object to the quest and shows its page', () => {
    const lever = { ...newObject(9100002), name: 'Lever', displayId: 1, pages: [{ id: 6001, text: 'Pull me.' }], onlyDuringQuest: true };
    expect(compile([lever]).inserts.gameobject_template![0]).toMatchObject({ type: '10', Data1: '60001', Data7: '6001' });
    const free = { ...lever, onlyDuringQuest: false, pages: [] };
    const row = compile([free]).inserts.gameobject_template![0]!;
    expect(row.Data1 ?? '0').toBe('0');
    expect(row.Data7 ?? '0').toBe('0');
  });
  it('limits a chest to the quest and keeps its loot id', () => {
    const chest = { ...newObject(9100003), type: 'chest' as const, name: 'Chest', displayId: 1, onlyDuringQuest: true };
    expect(compile([chest]).inserts.gameobject_template![0]).toMatchObject({ Data1: '9100003', Data8: '60001' });
  });
  it('needs pages on a readable object and warns about empty ones', () => {
    const codes = (o: ReturnType<typeof newObject>) =>
      entityIssues({ entities: { npcs: [], objects: [{ ...o, spawns: [{ guid: 1, map: 0, x: 1, y: 0, z: 0, o: 0, respawnSecs: 1, wander: 0 }] }] }, dbNames: new Map() }).map((i) => i.code);
    expect(codes({ ...newObject(1), type: 'text', name: 'N', displayId: 1 })).toEqual(['ENTITY_NO_PAGES']);
    expect(codes({ ...newObject(1), type: 'text', name: 'N', displayId: 1, pages: [{ id: 1, text: ' ' }] })).toEqual(['ENTITY_EMPTY_PAGE']);
  });
});

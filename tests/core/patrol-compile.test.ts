import { describe, expect, it } from 'vitest';
import { compilePatrols, hasPointActions } from '../../src/core/patrol/compile';
import { EMPTY_SCRIPT_CONTEXT } from '../../src/core/scripts/context';
import { newNpc, newSpawn, type Patrol, type PointAction } from '../../src/core/entities/model';
import { addAction, addPoint, newPatrol, updatePoint } from '../../src/core/map/patrol';

const Q = 60001;
const E = 12000001;
const NONE = { inserts: {}, deletes: {}, updates: [], flags: [], warnings: [] };
const route = (pathId = 9000): Patrol => addPoint(addPoint(newPatrol(pathId), { x: 1, y: 0, z: 0 }), { x: 2, y: 0, z: 0 });
const npcWith = (...patrols: Patrol[]) => ({ ...newNpc(E), spawns: patrols.map((p, i) => ({ ...newSpawn(900 + i), patrol: p })) });
const compile = (npc = npcWith(route()), context = EMPTY_SCRIPT_CONTEXT, taken = NONE) => compilePatrols({ questId: Q, npcs: [npc], context, taken });
const act = (a: Omit<PointAction, 'id' | 'afterSecs'> & Partial<PointAction>): PointAction => ({ id: 'a1', afterSecs: 0, ...a } as PointAction);

describe('point actions', () => {
  it('knows which NPCs have any', () => {
    expect(hasPointActions(npcWith(route()))).toBe(false);
    expect(hasPointActions(npcWith(addAction(route(), 0, act({ kind: 'dismount' }))))).toBe(true);
    expect(hasPointActions(npcWith(addAction(addPoint(newPatrol(1), { x: 1, y: 0, z: 0 }), 0, act({ kind: 'dismount' }))))).toBe(false);
  });

  it('puts one immediate action on the trigger row for that point of that path', () => {
    const out = compile(npcWith(addAction(route(), 1, act({ kind: 'emote', emote: 3 }))));
    expect(out.inserts.smart_scripts).toEqual([expect.objectContaining({
      entryorguid: String(E), source_type: '0', id: '0', event_type: '34', event_param1: '2', event_param2: '2', event_param3: '9000',
      action_type: '5', action_param1: '3', target_type: '1', event_chance: '100',
    })]);
    expect(out.inserts.smart_scripts![0]!.comment.startsWith(`AQC q${Q} patrol${E}`)).toBe(true);
  });

  it('runs several actions from a timed list, each waiting for the one before', () => {
    let p = addAction(route(), 0, act({ id: 'a1', kind: 'emote', emote: 3, afterSecs: 2 }));
    p = addAction(p, 0, act({ id: 'a2', kind: 'cast', spell: 1234 }));
    const rows = compile(npcWith(p)).inserts.smart_scripts!;
    expect(rows[0]).toMatchObject({ event_type: '34', event_param2: '1', action_type: '80', action_param1: String(E * 100) });
    const list = rows.filter((r) => r.source_type === '9');
    expect(list.map((r) => [r.action_type, r.event_param1])).toEqual([['11', '0'], ['5', '2000']]);
    expect(list[0]).toMatchObject({ action_param1: '1234', action_param2: '0', target_type: '1' });
  });

  it('says one of its lines, with its chance', () => {
    const say = act({ kind: 'say', chance: 25, lines: [{ text: 'Halt!', style: 'say' }, { text: 'WHO GOES THERE', style: 'yell' }] });
    const out = compile(npcWith(addAction(route(), 0, say)));
    expect(out.inserts.creature_text).toEqual([
      expect.objectContaining({ CreatureID: String(E), GroupID: '0', ID: '0', Text: 'Halt!', Type: '12', Probability: '100' }),
      expect.objectContaining({ CreatureID: String(E), GroupID: '0', ID: '1', Text: 'WHO GOES THERE', Type: '14', Probability: '100' }),
    ]);
    expect(out.inserts.smart_scripts![0]).toMatchObject({ action_type: '1', action_param1: '0', event_chance: '25', target_type: '1' });
    expect(out.inserts.creature_text![0]!.comment.startsWith(`AQC q${Q} patrol${E}`)).toBe(true);
  });

  it('holds a pose while it waits and stands up just before leaving', () => {
    const p = updatePoint(addAction(route(), 0, act({ kind: 'pose', emoteState: 68 })), 0, { waitSecs: 8 });
    const list = compile(npcWith(p)).inserts.smart_scripts!.filter((r) => r.source_type === '9');
    expect(list.map((r) => [r.action_type, r.action_param1, r.event_param1])).toEqual([['17', '68', '0'], ['17', '0', '7500']]);
  });

  it('undoes a pose at once when the point has no wait', () => {
    const p = updatePoint(addAction(route(), 0, act({ kind: 'pose', emoteState: 68 })), 0, { waitSecs: 0 });
    const list = compile(npcWith(p)).inserts.smart_scripts!.filter((r) => r.source_type === '9');
    expect(list.map((r) => [r.action_param1, r.event_param1])).toEqual([['68', '0'], ['0', '0']]);
  });

  it('writes sound, mount, dismount and using an object', () => {
    let p = addAction(route(), 0, act({ id: 'a1', kind: 'sound', sound: 1234 }));
    p = addAction(p, 0, act({ id: 'a2', kind: 'mount', creature: 308 }));
    p = addAction(p, 0, act({ id: 'a3', kind: 'dismount' }));
    p = addAction(p, 0, act({ id: 'a4', kind: 'useObject', guid: 77001, entry: 175000 }));
    const list = compile(npcWith(p)).inserts.smart_scripts!.filter((r) => r.source_type === '9');
    expect(list.map((r) => [r.action_type, r.action_param1, r.action_param2, r.target_type, r.target_param1, r.target_param2])).toEqual([
      ['4', '1234', '0', '1', '0', '0'],
      ['43', '308', '0', '1', '0', '0'],
      ['43', '0', '0', '1', '0', '0'],
      ['9', '0', '0', '14', '77001', '175000'],
    ]);
  });

  it('keeps two spawns\' points apart by path id', () => {
    const a = addAction(route(9000), 0, act({ kind: 'emote', emote: 3 }));
    const b = addAction(route(9010), 0, act({ kind: 'emote', emote: 4 }));
    const rows = compile(npcWith(a, b)).inserts.smart_scripts!;
    expect(rows.map((r) => [r.id, r.event_param3, r.action_param1])).toEqual([['0', '9000', '3'], ['1', '9010', '4']]);
  });

  it('writes nothing for a route of fewer than two points', () => {
    const one = addAction(addPoint(newPatrol(9000), { x: 1, y: 0, z: 0 }), 0, act({ kind: 'emote', emote: 3 }));
    expect(compile(npcWith(one)).inserts.smart_scripts).toBeUndefined();
  });

  it('works around rows a fight or scene already uses, and deletes its own old rows', () => {
    const context = { ...EMPTY_SCRIPT_CONTEXT,
      smartScripts: [
        { entryorguid: String(E), source_type: '0', id: '0', link: '0', comment: `AQC q${Q} fight${E}: x` },
        { entryorguid: String(E), source_type: '0', id: '1', link: '0', comment: `AQC q${Q} patrol${E}: old` },
      ],
      creatureText: [{ CreatureID: String(E), GroupID: '0', ID: '0', comment: `AQC q${Q} patrol${E}: old` }] };
    const taken = { ...NONE, inserts: { smart_scripts: [{ entryorguid: String(E), source_type: '0', id: '1', link: '0' }] } };
    const out = compile(npcWith(addAction(route(), 0, act({ kind: 'emote', emote: 3 }))), context, taken);
    expect(out.inserts.smart_scripts![0]!.id).toBe('2');
    expect(out.deletes.smart_scripts).toEqual([{ entryorguid: String(E), source_type: '0', id: '1', link: '0' }]);
    expect(out.deletes.creature_text).toEqual([{ CreatureID: String(E), GroupID: '0', ID: '0' }]);
  });
  it('leaves out actions with nothing picked, and blank lines', () => {
    let p = addAction(route(), 0, act({ id: 'a1', kind: 'mount', creature: 0 }));
    p = addAction(p, 0, act({ id: 'a2', kind: 'cast', spell: 0 }));
    p = addAction(p, 0, act({ id: 'a3', kind: 'sound', sound: 0 }));
    p = addAction(p, 0, act({ id: 'a4', kind: 'useObject', guid: 0, entry: 0 }));
    p = addAction(p, 0, act({ id: 'a5', kind: 'say', chance: 100, lines: [{ text: '  ', style: 'say' }] }));
    p = addAction(p, 0, act({ id: 'a6', kind: 'say', chance: 100, lines: [{ text: '', style: 'say' }, { text: 'Halt!', style: 'yell' }] }));
    const out = compile(npcWith(p));
    expect(out.inserts.creature_text).toEqual([expect.objectContaining({ ID: '0', Text: 'Halt!', Type: '14' })]);
    expect(out.inserts.smart_scripts).toEqual([expect.objectContaining({ event_type: '34', action_type: '1' })]);
  });

  it('never says a line with a chance of 0, and rounds a chance to a whole percent', () => {
    const never = addAction(route(), 0, act({ kind: 'say', chance: 0, lines: [{ text: 'Hm.', style: 'say' }] }));
    expect(compile(npcWith(never)).inserts.smart_scripts).toBeUndefined();
    const some = addAction(route(), 0, act({ kind: 'say', chance: 33.6, lines: [{ text: 'Hm.', style: 'say' }] }));
    expect(compile(npcWith(some)).inserts.smart_scripts![0]!.event_chance).toBe('34');
  });
});

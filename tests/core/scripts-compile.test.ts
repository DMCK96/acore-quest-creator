import { describe, expect, it } from 'vitest';
import { compileScenes } from '../../src/core/scripts/compile';
import { EMPTY_SCRIPT_CONTEXT, type ScriptContext } from '../../src/core/scripts/context';
import type { QuestScene } from '../../src/core/scripts/model';
import { sceneFromComment } from '../../src/core/scripts/tag';

const Q = 60001;
const base = (over: Partial<QuestScene>): QuestScene => ({
  id: 's1', name: '', owner: { kind: 'creature', entry: 299 },
  trigger: { kind: 'spellHit', spellId: 8593 }, gates: [], steps: [], ...over,
});
const ctx = (over: Partial<ScriptContext> = {}): ScriptContext => ({
  ...EMPTY_SCRIPT_CONTEXT,
  creatures: [{ entry: '299', npcflag: '0', gossip_menu_id: '0', AIName: '', ScriptName: '' }],
  ...over,
});
const compile = (scenes: QuestScene[], context = ctx(), objectives = [299, 0, 0, 0]) =>
  compileScenes({ questId: Q, scenes, objectives, context });
const smart = (out: ReturnType<typeof compile>) => out.inserts.smart_scripts ?? [];

describe('compileScenes: shapes', () => {
  it('puts a single immediate step on the trigger row', () => {
    const out = compile([base({ steps: [{ kind: 'credit', objective: 1, group: false, waitMs: 0 }] })]);
    expect(smart(out)).toHaveLength(1);
    expect(smart(out)[0]).toMatchObject({
      entryorguid: '299', source_type: '0', id: '0', link: '0', event_type: '8', event_param1: '8593',
      action_type: '33', action_param1: '299', target_type: '7',
    });
    expect(sceneFromComment(smart(out)[0]!.comment!)).toEqual(base({ steps: [{ kind: 'credit', objective: 1, group: false, waitMs: 0 }] }));
  });
  it('runs several steps as a timed action list that keeps the player', () => {
    const out = compile([base({ steps: [
      { kind: 'credit', objective: 1, group: false, waitMs: 0 },
      { kind: 'despawn', entry: 0, range: 0, waitMs: 2000 },
    ] })]);
    const rows = smart(out);
    expect(rows[0]).toMatchObject({ source_type: '0', action_type: '80', action_param1: '29900', action_param2: '2', action_param3: '0', target_type: '1' });
    const list = rows.filter((r) => r.source_type === '9');
    expect(list.map((r) => [r.entryorguid, r.id, r.event_type, r.event_param1, r.event_param2, r.action_type])).toEqual([
      ['29900', '0', '0', '0', '0', '33'],
      ['29900', '1', '0', '2000', '2000', '41'],
    ]);
    expect(list.every((r) => r.comment!.startsWith('AQC q60001 s1'))).toBe(true);
  });
  it('chains area-trigger steps with links because triggers cannot run lists', () => {
    const out = compile([base({
      owner: { kind: 'areatrigger', id: 4521 }, trigger: { kind: 'enterArea' },
      steps: [{ kind: 'eventCredit', group: false, waitMs: 0 }, { kind: 'castOnPlayer', spellId: 100, waitMs: 0 }],
    })]);
    expect(smart(out).map((r) => [r.source_type, r.id, r.link, r.event_type, r.action_type])).toEqual([
      ['2', '0', '1', '46', '15'],
      ['2', '1', '0', '61', '11'],
    ]);
    expect(out.inserts.areatrigger_scripts).toEqual([{ entry: '4521', ScriptName: 'SmartTrigger' }]);
  });
  it('turns gates into conditions on the trigger row', () => {
    const out = compile([base({
      gates: [{ kind: 'quest', questId: 0, state: 'inLog', negate: false }, { kind: 'team', team: 'horde' }],
      steps: [{ kind: 'credit', objective: 1, group: false, waitMs: 0 }],
    })]);
    expect(out.inserts.conditions!.map((c) => [c.SourceTypeOrReferenceId, c.SourceGroup, c.SourceEntry, c.SourceId, c.ConditionTypeOrReference, c.ConditionValue1, c.NegativeCondition])).toEqual([
      ['22', '1', '299', '0', '9', '60001', '0'],
      ['22', '1', '299', '0', '6', '67', '0'],
    ]);
    expect(out.inserts.conditions!.every((c) => c.Comment!.startsWith('AQC q60001 s1'))).toBe(true);
  });
  it('writes say lines to creature_text and sets the owner up for SmartAI', () => {
    const out = compile([base({ trigger: { kind: 'questAccepted' }, steps: [{ kind: 'say', text: 'Go, $N!', style: 'yell', waitMs: 0 }] })]);
    expect(out.inserts.creature_text).toEqual([expect.objectContaining({ CreatureID: '299', GroupID: '0', ID: '0', Text: 'Go, $N!', Type: '14', Probability: '100' })]);
    expect(smart(out)[0]).toMatchObject({ event_type: '19', event_param1: '60001', action_type: '1', action_param1: '0' });
    expect(out.updates).toEqual([{ table: 'creature_template', key: { entry: '299' }, set: { AIName: 'SmartAI' }, onlyIf: { AIName: '' } }]);
  });
  it('gives an object owner SmartGameObjectAI', () => {
    const out = compile([base({ owner: { kind: 'gameobject', entry: 500 }, trigger: { kind: 'talkedTo' }, steps: [{ kind: 'giveItem', item: 5, count: 1, waitMs: 0 }] })],
      ctx({ gameobjects: [{ entry: '500', AIName: '', ScriptName: '' }] }));
    expect(smart(out)[0]).toMatchObject({ source_type: '1', event_type: '64', action_type: '56', action_param1: '5', action_param2: '1' });
    expect(out.updates).toEqual([{ table: 'gameobject_template', key: { entry: '500' }, set: { AIName: 'SmartGameObjectAI' }, onlyIf: { AIName: '' } }]);
  });
});

describe('compileScenes: gossip, escort and new areas', () => {
  it('creates a menu, an option gated like the scene, and the gossip flag', () => {
    const out = compile([base({
      trigger: { kind: 'gossipOption', text: 'I am ready.', greeting: 'Well met.' },
      gates: [{ kind: 'quest', questId: 0, state: 'inLog', negate: false }],
      steps: [{ kind: 'eventCredit', group: false, waitMs: 0 }],
    })], ctx({ gossipMenuMax: 90000, npcTextMax: 800000 }));
    expect(out.inserts.gossip_menu).toEqual([{ MenuID: '90001', TextID: '800001' }]);
    expect(out.inserts.npc_text).toEqual([expect.objectContaining({ ID: '800001', text0_0: 'Well met.' })]);
    expect(out.inserts.gossip_menu_option).toEqual([expect.objectContaining({ MenuID: '90001', OptionID: '0', OptionText: 'I am ready.', OptionType: '1', OptionNpcFlag: '1' })]);
    expect(out.updates).toContainEqual({ table: 'creature_template', key: { entry: '299' }, set: { gossip_menu_id: '90001' }, onlyIf: { gossip_menu_id: '0' } });
    expect(out.flags).toEqual([{ table: 'creature_template', column: 'npcflag', bit: 1, key: { entry: '299' } }]);
    expect(smart(out)[0]).toMatchObject({ event_type: '62', event_param1: '90001', event_param2: '0' });
    const gossipConds = out.inserts.conditions!.filter((c) => c.SourceTypeOrReferenceId === '15');
    expect(gossipConds.map((c) => [c.SourceGroup, c.SourceEntry, c.ConditionTypeOrReference, c.ConditionValue1])).toEqual([['90001', '0', '9', '60001']]);
  });
  it('adds an option to an existing menu without touching its other options', () => {
    const out = compile([base({ trigger: { kind: 'gossipOption', text: 'Tell me more.', greeting: '' }, steps: [{ kind: 'closeGossip', waitMs: 0 }] })],
      ctx({
        creatures: [{ entry: '299', npcflag: '1', gossip_menu_id: '4000', AIName: 'SmartAI', ScriptName: '' }],
        gossipOptions: [{ MenuID: '4000', OptionID: '0' }, { MenuID: '4000', OptionID: '1' }],
      }));
    expect(out.inserts.gossip_menu).toBeUndefined();
    expect(out.inserts.gossip_menu_option).toEqual([expect.objectContaining({ MenuID: '4000', OptionID: '2' })]);
    expect(out.updates).toEqual([]);
    expect(out.flags).toEqual([]);
  });
  it('writes escort points and starts the escort for this quest', () => {
    const out = compile([base({
      trigger: { kind: 'questAccepted' },
      steps: [{ kind: 'startEscort', run: false, points: [{ x: 1, y: 2, z: 3, o: 0 }, { x: 4, y: 5, z: 6, o: 0 }], waitMs: 0 }],
    })], ctx({ waypointsMax: 2990 }));
    expect(out.inserts.waypoints!.map((w) => [w.entry, w.pointid, w.position_x, w.position_y, w.position_z])).toEqual([
      ['2991', '1', '1', '2', '3'], ['2991', '2', '4', '5', '6'],
    ]);
    expect(smart(out)[0]).toMatchObject({ action_type: '53', action_param1: '0', action_param2: '2991', action_param4: '60001', target_type: '7' });
  });
  it('points waypoint scenes at the escort scene path', () => {
    const escort = base({ trigger: { kind: 'questAccepted' }, steps: [{ kind: 'startEscort', run: true, points: [{ x: 1, y: 1, z: 1, o: 0 }], waitMs: 0 }] });
    const arrive = base({ id: 's2', trigger: { kind: 'waypointReached', escortSceneId: 's1', point: 1 }, steps: [{ kind: 'say', text: 'Here.', style: 'say', waitMs: 0 }] });
    const out = compile([escort, arrive], ctx({ waypointsMax: 10 }));
    expect(smart(out).find((r) => r.event_type === '40')).toMatchObject({ event_param1: '1', event_param2: '11' });
  });
  it('creates a new area trigger at the author position', () => {
    const out = compile([base({
      owner: { kind: 'areatrigger', id: 0, area: { map: 0, x: -8900, y: -100, z: 80, radius: 5 } },
      trigger: { kind: 'enterArea' }, steps: [{ kind: 'eventCredit', group: false, waitMs: 0 }],
    })], ctx({ areatriggerMax: 5000 }));
    expect(out.inserts.areatrigger).toEqual([expect.objectContaining({ entry: '5001', map: '0', x: '-8900', y: '-100', z: '80', radius: '5' })]);
    expect(smart(out)[0]).toMatchObject({ entryorguid: '5001', source_type: '2', event_param1: '5001' });
  });
});

describe('compileScenes: ownership and allocation', () => {
  const foreign = { entryorguid: '299', source_type: '0', id: '0', link: '0', comment: 'Wolf - On Aggro - Cast' };
  it('allocates around rows it does not own', () => {
    const out = compile([base({ steps: [{ kind: 'credit', objective: 1, group: false, waitMs: 0 }] })],
      ctx({ smartScripts: [foreign, { ...foreign, id: '1' }] }));
    expect(smart(out)[0]!.id).toBe('2');
    expect(out.deletes.smart_scripts ?? []).toEqual([]);
  });
  it('deletes its own previous rows, wherever they are, and reuses their ids', () => {
    const oldOnOtherOwner = { entryorguid: '777', source_type: '0', id: '5', link: '0', comment: 'AQC q60001 s9: old' };
    const oldHere = { entryorguid: '299', source_type: '0', id: '0', link: '0', comment: 'AQC q60001 s1: old' };
    const out = compile([base({ steps: [{ kind: 'credit', objective: 1, group: false, waitMs: 0 }] })],
      ctx({ smartScripts: [foreign, oldHere, oldOnOtherOwner].map((r, i) => (i === 0 ? { ...r, id: '1' } : r)) }));
    expect(out.deletes.smart_scripts).toEqual([
      { entryorguid: '299', source_type: '0', id: '0', link: '0' },
      { entryorguid: '777', source_type: '0', id: '5', link: '0' },
    ]);
    expect(smart(out)[0]!.id).toBe('0');
  });
  it('skips timed list ids other rows use', () => {
    const out = compile([base({ steps: [{ kind: 'emote', emote: 1, waitMs: 0 }, { kind: 'emote', emote: 2, waitMs: 500 }] })],
      ctx({ smartScripts: [{ entryorguid: '29900', source_type: '9', id: '0', link: '0', comment: 'someone else' }] }));
    expect(smart(out)[0]!.action_param1).toBe('29901');
  });
  it('deletes the gossip option and new area trigger its previous rows point at', () => {
    const oldGossip = { entryorguid: '299', source_type: '0', id: '0', link: '0', event_type: '62', event_param1: '4000', event_param2: '3', comment: 'AQC q60001 s1: x' };
    const oldArea = { entryorguid: '5001', source_type: '2', id: '0', link: '0', event_type: '46', event_param1: '5001',
      comment: 'AQC q60001 s2: x #aqc=' + JSON.stringify(base({ id: 's2', owner: { kind: 'areatrigger', id: 5001, area: { map: 0, x: 0, y: 0, z: 0, radius: 5 } }, trigger: { kind: 'enterArea' } })) };
    const out = compile([], ctx({ smartScripts: [oldGossip, oldArea] }));
    expect(out.deletes.gossip_menu_option).toEqual([{ MenuID: '4000', OptionID: '3' }]);
    expect(out.deletes.areatrigger).toEqual([{ entry: '5001' }]);
    expect(out.deletes.areatrigger_scripts).toEqual([{ entry: '5001' }]);
  });
  it('keeps the rows of a scene whose data it cannot read', () => {
    const unreadable = { entryorguid: '299', source_type: '0', id: '0', link: '0', event_type: '8', comment: 'AQC q60001 s7: x #aqc={broken' };
    const out = compile([], ctx({ smartScripts: [unreadable] }));
    expect(out.deletes.smart_scripts ?? []).toEqual([]);
    expect(out.warnings[0]).toMatch(/s7/);
  });
});

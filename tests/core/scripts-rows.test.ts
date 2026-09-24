import { describe, expect, it } from 'vitest';
import { createAllocator, emitTrigger, smartRow, type SmartAction } from '../../src/core/scripts/rows';
import { fightEntryOf, fightTag, sceneIdOf } from '../../src/core/scripts/tag';
import { compileScenes } from '../../src/core/scripts/compile';
import { EMPTY_SCRIPT_CONTEXT } from '../../src/core/scripts/context';

const act = (type: number, waitMs = 0, describe = 'd'): SmartAction => ({ type, params: [1, 2], target: 1, targetParams: [], waitMs, describe });

describe('fight tags', () => {
  it('tags and reads back fight rows, which are never scene rows', () => {
    expect(fightTag(60001, 12000001)).toBe('AQC q60001 fight12000001');
    expect(fightEntryOf('AQC q60001 fight12000001: Casts spell 116', 60001)).toBe(12000001);
    expect(fightEntryOf('AQC q600011 fight1: x', 60001)).toBeNull();
    expect(fightEntryOf('AQC q60001 s1: x', 60001)).toBeNull();
    expect(sceneIdOf('AQC q60001 fight12000001: x', 60001)).toBeNull();
  });
});

describe('smartRow', () => {
  it('fills every column, with phase mask and flags', () => {
    const row = smartRow({ entryorguid: 5, source: 0, id: 3, link: 0, eventType: 2, eventParams: [0, 30], action: act(11), comment: 'c', phaseMask: 2, eventFlags: 1 });
    expect(row).toEqual({
      entryorguid: '5', source_type: '0', id: '3', link: '0', event_type: '2', event_phase_mask: '2', event_chance: '100', event_flags: '1',
      event_param1: '0', event_param2: '30', event_param3: '0', event_param4: '0', event_param5: '0', event_param6: '0',
      action_type: '11', action_param1: '1', action_param2: '2', action_param3: '0', action_param4: '0', action_param5: '0', action_param6: '0',
      target_type: '1', target_param1: '0', target_param2: '0', target_param3: '0', target_param4: '0',
      target_x: '0', target_y: '0', target_z: '0', target_o: '0', comment: 'c',
    });
  });
});

describe('createAllocator', () => {
  it('goes around ids, list slots and text groups already in use', () => {
    const alloc = createAllocator({
      smartScripts: [
        { entryorguid: '5', source_type: '0', id: '0' }, { entryorguid: '5', source_type: '0', id: '1' },
        { entryorguid: '500', source_type: '9', id: '0' },
      ],
      creatureText: [{ CreatureID: '5', GroupID: '0' }],
    });
    expect(alloc.takeId(5, 0)).toBe(2);
    expect(alloc.takeId(5, 0)).toBe(3);
    expect(alloc.takeId(5, 1)).toBe(0);
    expect(alloc.takeList(5)).toBe(501);
    expect(alloc.takeGroup(5)).toBe(1);
  });
});

describe('emitTrigger', () => {
  const base = { entryorguid: 5, source: 0, eventType: 4, eventParams: [], header: 'H', tag: 'T' };
  it('puts one immediate action on the trigger row', () => {
    const out = emitTrigger({ ...base, alloc: createAllocator({ smartScripts: [], creatureText: [] }), actions: [act(11)], shape: 'list', phaseMask: 1, eventFlags: 1 })!;
    expect(out.triggerId).toBe(0);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toMatchObject({ event_type: '4', action_type: '11', event_phase_mask: '1', event_flags: '1', comment: 'H' });
  });
  it('calls a timed list for several actions, the list rows carrying the waits', () => {
    const out = emitTrigger({ ...base, alloc: createAllocator({ smartScripts: [], creatureText: [] }), actions: [act(1), act(11, 2000, 'cast')], shape: 'list' })!;
    expect(out.rows.map((r) => [r.entryorguid, r.source_type, r.id, r.event_type, r.event_param1, r.action_type, r.comment])).toEqual([
      ['5', '0', '0', '4', '0', '80', 'H'],
      ['500', '9', '0', '0', '0', '1', 'T: d'],
      ['500', '9', '1', '0', '2000', '11', 'T: cast'],
    ]);
    // SMART_ACTION_CALL_TIMED_ACTIONLIST is [id, timerType, allowOverride]: timer 2 runs in and out of combat.
    expect(out.rows[0]).toMatchObject({ action_param1: '500', action_param2: '2', action_param3: '0', target_type: '1' });
  });
  it('lets a later list take over a running one when asked', () => {
    const out = emitTrigger({ ...base, alloc: createAllocator({ smartScripts: [], creatureText: [] }), actions: [act(1), act(2)], shape: 'list', listOverride: true })!;
    expect(out.rows[0]).toMatchObject({ action_param2: '2', action_param3: '1' });
  });
  it('chains actions with links when asked, ignoring waits', () => {
    const out = emitTrigger({ ...base, alloc: createAllocator({ smartScripts: [], creatureText: [] }), actions: [act(1), act(33, 500)], shape: 'link' })!;
    expect(out.rows.map((r) => [r.id, r.link, r.event_type, r.action_type])).toEqual([['0', '1', '4', '1'], ['1', '0', '61', '33']]);
  });
  it('returns null when every list slot is taken', () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ entryorguid: String(500 + i), source_type: '9', id: '0' }));
    expect(emitTrigger({ ...base, alloc: createAllocator({ smartScripts: full, creatureText: [] }), actions: [act(1), act(2)], shape: 'list' })).toBeNull();
  });
});

describe('scene compiler and fight rows', () => {
  it('leaves fight rows alone and allocates around them', () => {
    const fightRow = { entryorguid: '299', source_type: '0', id: '0', link: '0', event_type: '0', comment: 'AQC q60001 fight299: Casts spell 116' };
    const out = compileScenes({
      questId: 60001,
      scenes: [{ id: 's1', name: '', owner: { kind: 'creature', entry: 299 }, trigger: { kind: 'dies' }, gates: [], steps: [{ kind: 'credit', objective: 1, group: false, waitMs: 0 }] }],
      objectives: [299, 0, 0, 0],
      context: { ...EMPTY_SCRIPT_CONTEXT, smartScripts: [fightRow], creatures: [{ entry: '299', npcflag: '0', gossip_menu_id: '0', AIName: 'SmartAI', ScriptName: '' }] },
    });
    expect(out.deletes.smart_scripts ?? []).toEqual([]);
    expect(out.inserts.smart_scripts![0]).toMatchObject({ entryorguid: '299', id: '1' });
  });
});

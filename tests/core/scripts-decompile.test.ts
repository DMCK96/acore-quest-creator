import { describe, expect, it } from 'vitest';
import { foreignScenes, scenesFromRows } from '../../src/core/scripts/decompile';
import { compileScenes } from '../../src/core/scripts/compile';
import { EMPTY_SCRIPT_CONTEXT } from '../../src/core/scripts/context';
import type { QuestScene } from '../../src/core/scripts/model';

const Q = 60001;
const scenes: QuestScene[] = [
  { id: 's1', name: 'Totem', owner: { kind: 'creature', entry: 299 }, trigger: { kind: 'spellHit', spellId: 8593 }, gates: [],
    steps: [{ kind: 'credit', objective: 1, group: false, waitMs: 0 }, { kind: 'despawn', entry: 0, range: 0, waitMs: 1500 }] },
  { id: 's3', name: '', owner: { kind: 'gameobject', entry: 500 }, trigger: { kind: 'talkedTo' }, gates: [],
    steps: [{ kind: 'giveItem', item: 7, count: 2, waitMs: 0 }] },
];

describe('decompiling', () => {
  it('rebuilds the scenes it compiled, in scene id order', () => {
    const out = compileScenes({ questId: Q, scenes, objectives: [299, 0, 0, 0], context: {
      ...EMPTY_SCRIPT_CONTEXT, creatures: [{ entry: '299', AIName: 'SmartAI', npcflag: '0', gossip_menu_id: '0', ScriptName: '' }],
      gameobjects: [{ entry: '500', AIName: 'SmartGameObjectAI', ScriptName: '' }] } });
    expect(scenesFromRows(Q, out.inserts.smart_scripts!)).toEqual({ scenes, unreadable: [] });
  });
  it('lists scenes whose data is damaged', () => {
    const rows = [{ entryorguid: '299', source_type: '0', id: '0', link: '0', event_type: '8', comment: 'AQC q60001 s4: x #aqc={' }];
    expect(scenesFromRows(Q, rows)).toEqual({ scenes: [], unreadable: ['s4'] });
  });
});

describe('foreign scripts', () => {
  it('describes rows the tool did not write, grouped by trigger, and marks combat', () => {
    const rows = [
      { entryorguid: '299', source_type: '0', id: '0', link: '1', event_type: '6', action_type: '33', action_param1: '299', comment: 'Wolf - On Death - Credit' },
      { entryorguid: '299', source_type: '0', id: '1', link: '0', event_type: '61', action_type: '1', comment: 'Wolf - Linked - Say' },
      { entryorguid: '299', source_type: '0', id: '2', link: '0', event_type: '4', action_type: '11', comment: 'Wolf - On Aggro - Cast' },
      { entryorguid: '299', source_type: '0', id: '3', link: '0', event_type: '8', action_type: '33', comment: 'AQC q60001 s1: ours' },
    ];
    expect(foreignScenes(Q, rows)).toEqual([
      { ownerKind: 'creature', entry: 299, trigger: 'when it dies', steps: ['give kill credit', 'say a line'], combat: false },
      { ownerKind: 'creature', entry: 299, trigger: 'when it enters combat', steps: ['cast a spell'], combat: true },
    ]);
  });
});

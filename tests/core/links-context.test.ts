import { describe, it, expect } from 'vitest';
import { readLinkContext, questNamedBy } from '@core/links/context';
import { describeEvent, actionName, sourceName } from '@core/smartai/ids';
import type { ScriptRow } from '@core/links/model';
import { forkDb } from '../helpers/fixtures';

const script = (over: Record<string, string>) => ({ source_type: '0', id: '0', link: '0', event_type: '0', action_type: '0', comment: '', ...over });

function seed() {
  const db = forkDb();
  // NPC 100 offers quest 500 on gossip option: event row 0 links to offer row 1.
  db.insert('smart_scripts', script({ entryorguid: '100', id: '0', link: '1', event_type: '62', event_param1: '9000', event_param2: '1', action_type: '1' }));
  db.insert('smart_scripts', script({ entryorguid: '100', id: '1', event_type: '61', action_type: '7', action_param1: '500' }));
  db.insert('smart_scripts', script({ entryorguid: '100', id: '2', event_type: '1', action_type: '11' })); // same script, unrelated
  db.insert('smart_scripts', script({ entryorguid: '101', event_type: '20', event_param1: '500', action_type: '1' })); // names 500 by event
  db.insert('smart_scripts', script({ entryorguid: '500', source_type: '5', event_type: '48', action_type: '12' })); // quest script
  db.insert('smart_scripts', script({ entryorguid: '7700', source_type: '9', action_type: '7', action_param1: '501' })); // timed list offers 501
  db.insert('smart_scripts', script({ entryorguid: '102', event_type: '64', action_type: '80', action_param1: '7700' })); // caller of 7700
  db.insert('smart_scripts', script({ entryorguid: '103', action_type: '7', action_param1: '999' })); // other quest
  db.insert('conditions', { SourceTypeOrReferenceId: '22', SourceGroup: '1', SourceEntry: '100', SourceId: '0', ConditionTypeOrReference: '9', ConditionValue1: '499' });
  db.insert('item_template', { entry: '25', name: 'Letter', startquest: '500' });
  db.insert('smart_scripts', script({ entryorguid: '4521', source_type: '2', event_type: '46', event_param1: '4521', action_type: '7', action_param1: '502' }));
  db.insert('areatrigger_scripts', { entry: '4521', ScriptName: 'SmartTrigger' });
  return db;
}

describe('readLinkContext', () => {
  it('finds every row that names a quest in scope, by action, event or quest script', async () => {
    const ctx = await readLinkContext(seed(), [500]);
    const keys = ctx.questRows.map((r) => `${r.entryorguid}/${r.sourceType}/${r.id}`).sort();
    expect(keys).toEqual(['100/0/1', '101/0/0', '500/5/0']);
  });
  it('reads the whole script of each such row, and the conditions on its events', async () => {
    const ctx = await readLinkContext(seed(), [500]);
    expect(ctx.scripts.filter((r) => r.entryorguid === 100).map((r) => r.id)).toEqual([0, 1, 2]);
    expect(ctx.eventConditions).toHaveLength(1);
  });
  it('follows a timed action list back to the script that calls it', async () => {
    const ctx = await readLinkContext(seed(), [501]);
    expect(ctx.scripts.some((r) => r.entryorguid === 102 && r.actionType === 80)).toBe(true);
  });
  it('reads item starters and area-trigger script names', async () => {
    expect((await readLinkContext(seed(), [500])).itemStarters).toEqual([{ entry: 25, questId: 500 }]);
    expect((await readLinkContext(seed(), [502])).areatriggerScripts).toEqual([{ entry: 4521, scriptName: 'SmartTrigger' }]);
  });
  it('treats a missing smart_scripts table as no rows', async () => {
    const db = seed();
    db.dropTable('smart_scripts');
    const ctx = await readLinkContext(db, [500]);
    expect(ctx.questRows).toEqual([]);
    expect(ctx.itemStarters).toHaveLength(1);
  });
  it('asks nothing for an empty list', async () => {
    expect(await readLinkContext(seed(), [])).toEqual({ questRows: [], scripts: [], eventConditions: [], itemStarters: [], areatriggerScripts: [], aiNames: [] });
  });
  it('reads the AIName of every creature and object that owns a script', async () => {
    const db = seed();
    db.insert('creature_template', { entry: '100', name: 'Marshal', AIName: 'SmartAI' });
    db.insert('creature_template', { entry: '101', name: 'Guard', AIName: '' });
    const ctx = await readLinkContext(db, [500]);
    expect(ctx.aiNames).toEqual([{ sourceType: 0, entry: 100, aiName: 'SmartAI' }, { sourceType: 0, entry: 101, aiName: '' }]);
  });
});

describe('questNamedBy', () => {
  const row = (over: Partial<ScriptRow>): ScriptRow => ({ entryorguid: 1, sourceType: 0, id: 0, link: 0, eventType: 0, eventParams: [0, 0, 0, 0, 0, 0], actionType: 0, actionParams: [0, 0, 0, 0, 0, 0], targetType: 0, comment: '', ...over });
  it('reads the quest from the action, the event, an escort or a quest script', () => {
    const ids = new Set([5]);
    expect(questNamedBy(row({ actionType: 7, actionParams: [5, 0, 0, 0, 0, 0] }), ids)).toBe(5);
    expect(questNamedBy(row({ eventType: 19, eventParams: [5, 0, 0, 0, 0, 0] }), ids)).toBe(5);
    expect(questNamedBy(row({ actionType: 53, actionParams: [0, 0, 0, 5, 0, 0] }), ids)).toBe(5);
    expect(questNamedBy(row({ actionType: 55, actionParams: [0, 5, 0, 0, 0, 0] }), ids)).toBe(5);
    expect(questNamedBy(row({ sourceType: 5, entryorguid: 5 }), ids)).toBe(5);
    expect(questNamedBy(row({ actionType: 7, actionParams: [6, 0, 0, 0, 0, 0] }), ids)).toBeUndefined();
  });
});

describe('SmartAI wording', () => {
  const row = (eventType: number, p: number[] = []): ScriptRow => ({ entryorguid: 1, sourceType: 0, id: 0, link: 0, eventType, eventParams: [...p, 0, 0, 0, 0, 0, 0].slice(0, 6), actionType: 0, actionParams: [0, 0, 0, 0, 0, 0], targetType: 0, comment: '' });
  it('describes events in plain words', () => {
    expect(describeEvent(row(62, [9000, 1]))).toBe('when the player chooses gossip option 1 of menu 9000');
    expect(describeEvent(row(46, [4521]))).toBe('when the player enters area trigger 4521');
    expect(describeEvent(row(20, [500]))).toBe('when quest 500 is turned in');
    expect(describeEvent(row(250))).toBe('on SmartAI event 250');
    expect(actionName(7)).toBe('offer quest');
    expect(actionName(250)).toBe('SmartAI action 250');
    expect(sourceName(9)).toBe('timed action list');
  });
});

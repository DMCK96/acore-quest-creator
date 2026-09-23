// tests/core/links-smartai.test.ts
import { describe, it, expect } from 'vitest';
import { recogniseLinks } from '@core/links/recognise';
import { componentById } from '@core/links/catalog';
import { readLinkContext } from '@core/links/context';
import { BACKEND_READ_ONLY, SMARTAI_READ_ONLY } from '@core/links/components/smartai';
import type { QuestFacts } from '@core/links/facts';
import { forkDb } from '../helpers/fixtures';

const fact = (questId: number, over: Partial<QuestFacts> = {}): QuestFacts => ({
  questId, isNew: false, prevQuestId: 0, nextQuestId: 0, rewardNextQuest: 0, breadcrumbFor: 0, exclusiveGroup: 0,
  creatureStarters: [], objectStarters: [], creatureEnders: [], objectEnders: [], eventStarters: [], availabilityConditions: 0, ...over,
});
const script = (over: Record<string, string>) => ({ source_type: '0', id: '0', link: '0', event_type: '0', action_type: '0', comment: '', ...over });

async function recognise(db: ReturnType<typeof forkDb>, facts: QuestFacts[]) {
  const ids = facts.map((f) => f.questId);
  return recogniseLinks({ facts: new Map(facts.map((f) => [f.questId, f])), context: await readLinkContext(db, ids) });
}

describe('start.smartai', () => {
  it('follows the link chain back to the event and claims every row on it plus its conditions', async () => {
    const db = forkDb();
    db.insert('smart_scripts', script({ entryorguid: '100', id: '0', link: '1', event_type: '62', event_param1: '9000', event_param2: '1', action_type: '1' }));
    db.insert('smart_scripts', script({ entryorguid: '100', id: '1', event_type: '61', action_type: '7', action_param1: '500' }));
    db.insert('conditions', { SourceTypeOrReferenceId: '22', SourceGroup: '1', SourceEntry: '100', SourceId: '0', ConditionTypeOrReference: '9', ConditionValue1: '499' });
    const r = await recognise(db, [fact(500)]);
    const [i] = r.instances.filter((x) => x.component === 'start.smartai');
    expect(i).toMatchObject({ owner: 500, from: { kind: 'creature', entry: 100 }, to: { kind: 'quest', questId: 500 }, editable: false, readOnlyReason: SMARTAI_READ_ONLY });
    expect(i.claims.map((c) => c.key)).toEqual(expect.arrayContaining([
      'entryorguid=100,source_type=0,id=1,link=0', 'entryorguid=100,source_type=0,id=0,link=1',
    ]));
    expect(i.claims.some((c) => c.table === 'conditions')).toBe(true);
    expect(componentById('start.smartai').describe(i, () => undefined)).toBe('Offered by a script on NPC 100 when the player chooses gossip option 1 of menu 9000');
    expect(r.instances.some((x) => x.component === 'start.backend')).toBe(false);
  });
  it('makes a quest-to-quest link when the script fires on another quest being turned in', async () => {
    const db = forkDb();
    db.insert('smart_scripts', script({ entryorguid: '100', event_type: '20', event_param1: '499', action_type: '7', action_param1: '500' }));
    const [i] = (await recognise(db, [fact(500)])).instances.filter((x) => x.component === 'start.smartai');
    expect(i.from).toEqual({ kind: 'quest', questId: 499 });
    expect(componentById('start.smartai').describe(i, () => undefined)).toBe('Offered by a script when quest 499 is turned in');
  });
  it('names a GUID-scoped script as a spawn, not a negative entry', async () => {
    const db = forkDb();
    db.insert('smart_scripts', script({ entryorguid: '-4242', event_type: '64', action_type: '7', action_param1: '500' }));
    const [i] = (await recognise(db, [fact(500)])).instances.filter((x) => x.component === 'start.smartai');
    expect(i.from).toEqual({ kind: 'creatureSpawn', guid: 4242 });
    expect(componentById('start.smartai').describe(i, () => undefined)).toBe('Offered by a script on a spawn of an NPC (GUID 4242) when the player talks to it');
  });
  it('resolves a timed action list to the script that calls it', async () => {
    const db = forkDb();
    db.insert('smart_scripts', script({ entryorguid: '7700', source_type: '9', action_type: '7', action_param1: '501' }));
    db.insert('smart_scripts', script({ entryorguid: '102', event_type: '64', action_type: '80', action_param1: '7700' }));
    const [i] = (await recognise(db, [fact(501)])).instances.filter((x) => x.component === 'start.smartai');
    expect(i.from).toEqual({ kind: 'creature', entry: 102 });
  });
  it('terminates on a link loop and still recognises the offer', async () => {
    const db = forkDb();
    db.insert('smart_scripts', script({ entryorguid: '100', id: '0', link: '1', event_type: '61', action_type: '1' }));
    db.insert('smart_scripts', script({ entryorguid: '100', id: '1', link: '0', event_type: '61', action_type: '7', action_param1: '500' }));
    const got = (await recognise(db, [fact(500)])).instances.filter((x) => x.component === 'start.smartai');
    expect(got).toHaveLength(1);
  });
  it('flags a script whose owner is not set up for SmartAI, but still counts it as a start', async () => {
    const db = forkDb();
    db.insert('creature_template', { entry: '100', name: 'Marshal', AIName: '' });
    db.insert('smart_scripts', script({ entryorguid: '100', event_type: '64', action_type: '7', action_param1: '500' }));
    const r = await recognise(db, [fact(500)]);
    const [i] = r.instances.filter((x) => x.component === 'start.smartai');
    expect(i.inactiveReason).toBe('NPC 100 does not use SmartAI (its AIName is ""), so this script never runs.');
    expect(r.instances.some((x) => x.component === 'start.backend')).toBe(false);
  });
  it('treats a SmartAI-ready owner as running, and checks area triggers for SmartTrigger', async () => {
    const db = forkDb();
    db.insert('creature_template', { entry: '100', name: 'Marshal', AIName: 'SmartAI' });
    db.insert('smart_scripts', script({ entryorguid: '100', event_type: '64', action_type: '7', action_param1: '500' }));
    db.insert('smart_scripts', script({ entryorguid: '4521', source_type: '2', event_type: '46', event_param1: '4521', action_type: '7', action_param1: '500' }));
    const got = (await recognise(db, [fact(500)])).instances.filter((x) => x.component === 'start.smartai');
    expect(got.find((x) => x.from.kind === 'creature')!.inactiveReason).toBeUndefined();
    expect(got.find((x) => x.from.kind === 'areatrigger')!.inactiveReason).toBe('Area trigger 4521 is not set to run SmartAI (it needs an areatrigger_scripts row with ScriptName "SmartTrigger"), so this script never runs.');
  });
  it('lists rows that name the quest but are not an offer as unrecognised', async () => {
    const db = forkDb();
    db.insert('smart_scripts', script({ entryorguid: '500', source_type: '5', event_type: '48', action_type: '12' }));
    const r = await recognise(db, [fact(500, { creatureStarters: [1] })]);
    expect(r.unrecognised).toEqual([expect.objectContaining({ questId: 500, ref: { table: 'smart_scripts', key: 'entryorguid=500,source_type=5,id=0,link=0' } })]);
  });
});

describe('start.item and start.backend', () => {
  it('reads an item that begins the quest, read-only', async () => {
    const db = forkDb();
    db.insert('item_template', { entry: '25', name: 'Letter', startquest: '500' });
    const [i] = (await recognise(db, [fact(500)])).instances.filter((x) => x.component === 'start.item');
    expect(i).toMatchObject({ from: { kind: 'item', entry: 25 }, claims: [{ table: 'item_template', key: 'entry=25', column: 'startquest' }], editable: false });
    expect(componentById('start.item').describe(i, () => undefined)).toBe('Begun by item 25');
  });
  it('infers a backend start only for an imported quest with no start of any kind', async () => {
    const r = await recognise(forkDb(), [fact(500), fact(501, { isNew: true }), fact(502, { creatureStarters: [1] })]);
    const backend = r.instances.filter((x) => x.component === 'start.backend');
    expect(backend).toEqual([{
      id: 'start.backend:500', component: 'start.backend', owner: 500, from: { kind: 'backend' }, to: { kind: 'quest', questId: 500 },
      params: {}, claims: [], editable: false, readOnlyReason: BACKEND_READ_ONLY,
    }]);
    expect(componentById('start.backend').describe(backend[0], () => undefined)).toBe('Started by backend');
  });
});

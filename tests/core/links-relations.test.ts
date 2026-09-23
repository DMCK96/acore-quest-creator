import { describe, it, expect } from 'vitest';
import { recogniseLinks } from '@core/links/recognise';
import { componentById } from '@core/links/catalog';
import { EMPTY_CONTEXT } from '@core/links/model';
import type { QuestFacts } from '@core/links/facts';

const fact = (questId: number, over: Partial<QuestFacts> = {}): QuestFacts => ({
  questId, isNew: false, prevQuestId: 0, nextQuestId: 0, rewardNextQuest: 0, breadcrumbFor: 0, exclusiveGroup: 0,
  creatureStarters: [], objectStarters: [], creatureEnders: [], objectEnders: [], eventStarters: [], availabilityConditions: 0, ...over,
});
const run = (f: QuestFacts) => recogniseLinks({ facts: new Map([[f.questId, f]]), context: EMPTY_CONTEXT }).instances;

describe('quest-giver components', () => {
  it('makes one instance per NPC and object starter', () => {
    const got = run(fact(7, { creatureStarters: [100, 101], objectStarters: [200] }));
    expect(got.filter((i) => i.component === 'start.npc').map((i) => i.from)).toEqual([{ kind: 'creature', entry: 100 }, { kind: 'creature', entry: 101 }]);
    expect(got.find((i) => i.component === 'start.object')).toMatchObject({
      owner: 7, to: { kind: 'quest', questId: 7 }, from: { kind: 'gameobject', entry: 200 },
      claims: [{ table: 'gameobject_queststarter', key: 'id=200,quest=7' }], editable: true,
    });
  });
  it('reads game-event givers with their event', () => {
    const [i] = run(fact(7, { eventStarters: [{ eventEntry: 12, kind: 'creature', id: 102 }] })).filter((x) => x.component === 'start.gameEvent');
    expect(i).toMatchObject({ from: { kind: 'creature', entry: 102 }, params: { eventEntry: 12 }, claims: [{ table: 'game_event_creature_quest', key: 'eventEntry=12,id=102,quest=7' }] });
    expect(componentById('start.gameEvent').describe(i, () => undefined)).toBe('Offered by NPC 102 during game event 12');
  });
  it('sums availability conditions into one instance', () => {
    const [i] = run(fact(7, { availabilityConditions: 2 })).filter((x) => x.component === 'gate.condition');
    expect(i).toMatchObject({ from: { kind: 'conditions' }, params: { count: 2 }, claims: [{ table: 'conditions', key: 'SourceTypeOrReferenceId=19,SourceEntry=7' }] });
    expect(componentById('gate.condition').describe(i, () => undefined)).toBe('Only available when 2 conditions hold');
  });
  it('adds a starter without duplicating an existing one', () => {
    const target = { facts: (id: number) => (id === 7 ? fact(7, { creatureStarters: [100] }) : undefined) };
    const write = componentById('start.npc').write!;
    expect(write({ npc: 101, quest: 7 }, target)).toEqual([{ questId: 7, fieldId: 'creature_queststarter', value: [{ id: 100 }, { id: 101 }] }]);
    expect(write({ npc: 100, quest: 7 }, target)).toEqual([]);
  });
  it('describes givers by name when it has one', () => {
    const [i] = run(fact(7, { creatureStarters: [100] })).filter((x) => x.component === 'start.npc');
    expect(componentById('start.npc').describe(i, (k, id) => (k === 'creature' && id === 100 ? 'Marshal' : undefined))).toBe('Offered by Marshal (100)');
  });
});

import { describe, it, expect } from 'vitest';
import { linkIssues, disconnectedQuests, NO_STARTER_MESSAGE, NOT_CONNECTED_MESSAGE } from '@core/links/issues';
import { recogniseLinks } from '@core/links/recognise';
import { EMPTY_CONTEXT } from '@core/links/model';
import type { QuestFacts } from '@core/links/facts';
import type { LinkSnapshot } from '@core/links/service';
import { registry } from '@core/registry';

const fact = (questId: number, over: Partial<QuestFacts> = {}): QuestFacts => ({
  questId, isNew: false, prevQuestId: 0, nextQuestId: 0, rewardNextQuest: 0, breadcrumbFor: 0, exclusiveGroup: 0,
  creatureStarters: [], objectStarters: [], creatureEnders: [], objectEnders: [], eventStarters: [], availabilityConditions: 0, ...over,
});
const snap = (...fs: QuestFacts[]): LinkSnapshot => {
  const facts = new Map(fs.map((f) => [f.questId, f]));
  return { facts, result: recogniseLinks({ facts, context: EMPTY_CONTEXT }) };
};

describe('linkIssues', () => {
  it('warns about a new quest nothing starts, and never about an imported one', () => {
    expect(linkIssues(1, snap(fact(1, { isNew: true })))).toEqual([
      { severity: 'warning', code: 'NO_STARTER', fieldId: 'creature_queststarter', message: NO_STARTER_MESSAGE },
    ]);
    expect(linkIssues(1, snap(fact(1)))).toEqual([]);
    expect(linkIssues(1, snap(fact(1, { isNew: true, creatureStarters: [5] })))).toEqual([]);
  });
  it('warns when "offered straight away" names a quest the turn-in NPC does not start', () => {
    const bad = snap(fact(1, { rewardNextQuest: 2, creatureEnders: [100], creatureStarters: [9] }), fact(2, { creatureStarters: [101] }));
    expect(linkIssues(1, bad)).toEqual([{
      severity: 'warning', code: 'OFFER_NOT_STARTED_BY_ENDER', fieldId: 'quest_template.RewardNextQuest',
      message: 'Quest 2 is offered straight away on turn-in, but none of the NPCs or objects that take this quest back start it, so nothing is offered.',
    }]);
    const good = snap(fact(1, { rewardNextQuest: 2, creatureEnders: [100], creatureStarters: [9] }), fact(2, { creatureStarters: [100] }));
    expect(linkIssues(1, good)).toEqual([]);
    const noEnder = snap(fact(1, { rewardNextQuest: 2, creatureStarters: [9] }), fact(2, { creatureStarters: [101] }));
    expect(linkIssues(1, noEnder)).toEqual([]);
  });
  it('warns when the script that offers the quest will never run', () => {
    const s = snap(fact(1));
    s.result.instances.push({
      id: 'x', component: 'start.smartai', owner: 1, from: { kind: 'creature', entry: 100 }, to: { kind: 'quest', questId: 1 },
      params: {}, claims: [], editable: false, inactiveReason: 'NPC 100 does not use SmartAI (its AIName is ""), so this script never runs.',
    });
    expect(linkIssues(1, s)).toContainEqual({
      severity: 'warning', code: 'SCRIPT_WILL_NOT_RUN', message: 'NPC 100 does not use SmartAI (its AIName is ""), so this script never runs.',
    });
  });
});

describe('disconnectedQuests', () => {
  it('flags only quests with no link to another quest on the canvas, and nothing when one quest is alone', () => {
    const s = snap(fact(1), fact(2, { prevQuestId: 1 }), fact(3), fact(4, { prevQuestId: 99 }));
    expect([...disconnectedQuests([1, 2, 3, 4], s)].sort()).toEqual([3, 4]);
    expect(disconnectedQuests([3], s).size).toBe(0);
    expect(NOT_CONNECTED_MESSAGE).toBe('Not connected to any other quest on the canvas.');
  });
});

describe('StartItem wording', () => {
  it('no longer claims the field starts the quest', () => {
    const f = registry.fields.find((x) => x.id === 'quest_template.StartItem')!;
    expect(f.label).toBe('Item given on accept');
    expect(f.help).toBe('An item put in the player\'s bags when they accept the quest, such as a letter to deliver. It does not start the quest: an item that begins a quest is set on the item itself. 0 for none.');
  });
});

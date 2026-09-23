import { describe, it, expect } from 'vitest';
import { recogniseLinks, type RecognitionResult } from '@core/links/recognise';
import { CATALOG, componentById } from '@core/links/catalog';
import { EMPTY_CONTEXT, type ComponentId } from '@core/links/model';
import type { QuestFacts } from '@core/links/facts';
import type { ComponentDef, NameBook, RecogniseInput } from '@core/links/component';

const fact = (questId: number, over: Partial<QuestFacts> = {}): QuestFacts => ({
  questId, isNew: false, prevQuestId: 0, nextQuestId: 0, rewardNextQuest: 0, breadcrumbFor: 0, exclusiveGroup: 0,
  creatureStarters: [], objectStarters: [], creatureEnders: [], objectEnders: [], eventStarters: [], availabilityConditions: 0, ...over,
});
const input = (...fs: QuestFacts[]): RecogniseInput => ({ facts: new Map(fs.map((f) => [f.questId, f])), context: EMPTY_CONTEXT });
const only = (r: RecognitionResult, c: ComponentId) => r.instances.filter((i) => i.component === c);
const noNames: NameBook = () => undefined;

describe('quest-column components', () => {
  it('reads a positive PrevQuestID as "unlocks after turn-in", owned by the later quest', () => {
    const [i] = only(recogniseLinks(input(fact(2, { prevQuestId: 1 }))), 'unlock.afterTurnIn');
    expect(i).toEqual({
      id: 'unlock.afterTurnIn:quest_template_addon[ID=2].PrevQuestID', component: 'unlock.afterTurnIn', owner: 2,
      from: { kind: 'quest', questId: 1 }, to: { kind: 'quest', questId: 2 }, params: { from: 1, to: 2 },
      claims: [{ table: 'quest_template_addon', key: 'ID=2', column: 'PrevQuestID' }], editable: true,
    });
  });
  it('reads a negative PrevQuestID as "unlocks while in log" from the absolute quest', () => {
    const [i] = only(recogniseLinks(input(fact(2, { prevQuestId: -1 }))), 'unlock.whileInLog');
    expect(i.from).toEqual({ kind: 'quest', questId: 1 });
  });
  it('never links a quest to itself', () => {
    const r = recogniseLinks(input(fact(2, { prevQuestId: 2, nextQuestId: 2, rewardNextQuest: 2, breadcrumbFor: 2 })));
    expect(r.instances.filter((i) => i.from.kind === 'quest' && i.to.kind === 'quest')).toEqual([]);
  });
  it('points NextQuestID, RewardNextQuest and breadcrumbs forward from the quest that holds them', () => {
    const r = recogniseLinks(input(fact(1, { nextQuestId: 2, rewardNextQuest: 3, breadcrumbFor: 4 })));
    expect(only(r, 'unlock.nextQuest')[0]).toMatchObject({ owner: 1, from: { questId: 1 }, to: { questId: 2 } });
    expect(only(r, 'start.offeredStraightAway')[0]).toMatchObject({ owner: 1, to: { questId: 3 }, claims: [{ table: 'quest_template', key: 'ID=1', column: 'RewardNextQuest' }] });
    expect(only(r, 'gate.breadcrumb')[0]).toMatchObject({ owner: 1, to: { questId: 4 } });
  });
});

describe('group components', () => {
  it('makes one "pick one" instance per positive group, owned by the lowest member', () => {
    const r = recogniseLinks(input(fact(22, { exclusiveGroup: 21 }), fact(21, { exclusiveGroup: 21 }), fact(23, { exclusiveGroup: -21 })));
    const [pick] = only(r, 'group.pickOne');
    expect(pick).toMatchObject({ owner: 21, from: { kind: 'group', group: 21 }, params: { group: 21, members: [21, 22], then: 0 } });
    expect(pick.claims).toEqual([
      { table: 'quest_template_addon', key: 'ID=21', column: 'ExclusiveGroup' },
      { table: 'quest_template_addon', key: 'ID=22', column: 'ExclusiveGroup' },
    ]);
    expect(only(r, 'group.finishAll')).toHaveLength(1); // -21 is a different group
  });
  it('reads "finish all" with a shared next quest, and claims those NextQuestIDs', () => {
    const r = recogniseLinks(input(fact(31, { exclusiveGroup: -31, nextQuestId: 40 }), fact(32, { exclusiveGroup: -31, nextQuestId: 40 })));
    expect(only(r, 'group.finishAll')[0].params).toEqual({ group: -31, members: [31, 32], then: 40 });
    expect(only(r, 'unlock.nextQuest')).toEqual([]);
  });
  it('does not guess "finish all" when the members point at different next quests', () => {
    const r = recogniseLinks(input(fact(31, { exclusiveGroup: -31, nextQuestId: 40 }), fact(32, { exclusiveGroup: -31, nextQuestId: 41 })));
    expect(only(r, 'group.finishAll')[0].params).toMatchObject({ then: 0 });
    expect(only(r, 'unlock.nextQuest')).toHaveLength(2);
  });
});

describe('writing', () => {
  const target = { facts: () => undefined };
  it('writes each quest-column link on the quest that owns the column', () => {
    expect(componentById('unlock.afterTurnIn').write!({ from: 1, to: 2 }, target)).toEqual([{ questId: 2, fieldId: 'quest_template_addon.PrevQuestID', value: 1 }]);
    expect(componentById('unlock.whileInLog').write!({ from: 1, to: 2 }, target)).toEqual([{ questId: 2, fieldId: 'quest_template_addon.PrevQuestID', value: -1 }]);
    expect(componentById('unlock.nextQuest').write!({ from: 1, to: 2 }, target)).toEqual([{ questId: 1, fieldId: 'quest_template_addon.NextQuestID', value: 2 }]);
    expect(componentById('start.offeredStraightAway').write!({ from: 1, to: 2 }, target)).toEqual([{ questId: 1, fieldId: 'quest_template.RewardNextQuest', value: 2 }]);
    expect(componentById('gate.breadcrumb').write!({ from: 1, to: 2 }, target)).toEqual([{ questId: 1, fieldId: 'quest_template_addon.BreadcrumbForQuestId', value: 2 }]);
  });
  it('writes groups with the sign that means what the user picked', () => {
    expect(componentById('group.pickOne').write!({ group: -5, members: [1, 2], then: 0 }, target)).toEqual([
      { questId: 1, fieldId: 'quest_template_addon.ExclusiveGroup', value: 5 },
      { questId: 2, fieldId: 'quest_template_addon.ExclusiveGroup', value: 5 },
    ]);
    expect(componentById('group.finishAll').write!({ group: 5, members: [1, 2], then: 9 }, target)).toEqual([
      { questId: 1, fieldId: 'quest_template_addon.ExclusiveGroup', value: -5 },
      { questId: 1, fieldId: 'quest_template_addon.NextQuestID', value: 9 },
      { questId: 2, fieldId: 'quest_template_addon.ExclusiveGroup', value: -5 },
      { questId: 2, fieldId: 'quest_template_addon.NextQuestID', value: 9 },
    ]);
  });
});

describe('describing', () => {
  const names: NameBook = (kind, id) => (kind === 'quest' && id === 1 ? 'Wolves' : undefined);
  it('uses names where it has them and IDs where it does not', () => {
    const [i] = only(recogniseLinks(input(fact(2, { prevQuestId: 1 }))), 'unlock.afterTurnIn');
    expect(componentById('unlock.afterTurnIn').describe(i, names)).toBe('Turning in Wolves (1) unlocks quest 2');
    const [b] = only(recogniseLinks(input(fact(3, { breadcrumbFor: 4 }))), 'gate.breadcrumb');
    expect(componentById('gate.breadcrumb').describe(b, noNames)).toBe('Quest 3 is a breadcrumb leading to quest 4');
  });
});

describe('recogniseLinks', () => {
  it('lets the first component in catalog order claim a row and drops later claims on it', () => {
    const claim = { table: 't', key: 'k' };
    const make = (id: ComponentId): ComponentDef => ({
      ...componentById('unlock.afterTurnIn'), id,
      recognise: () => [{ id, component: id, owner: 1, from: { kind: 'backend' }, to: { kind: 'quest', questId: 1 }, params: {}, claims: [claim], editable: false }],
    });
    const r = recogniseLinks(input(fact(1)), [make('unlock.afterTurnIn'), make('unlock.nextQuest')]);
    expect(r.instances.map((i) => i.component)).toEqual(['unlock.afterTurnIn']);
  });
  it('skips components that are not available', () => {
    const r = recogniseLinks(input(fact(2, { prevQuestId: 1 })), CATALOG, new Set<ComponentId>(['unlock.nextQuest']));
    expect(only(r, 'unlock.afterTurnIn')).toEqual([]);
  });
});

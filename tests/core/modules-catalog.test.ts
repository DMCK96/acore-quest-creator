import { describe, it, expect } from 'vitest';
import { registry, fieldById } from '@core/registry';
import {
  MODULES, HEADER_FIELDS, isHiddenField, moduleById, ownerOf,
  isModulePresent, presentModules, offeredModules, resetModule, formatMoney,
} from '@core/modules/catalog';
import type { NameBook } from '@core/links/component';

const NAMES: Record<string, string> = {
  'creature:240': 'Marshal Dughan',
  'creature:299': 'Diseased Young Wolf',
  'item:750': 'Tough Wolf Meat',
  'gameobject:3000': 'Wanted Poster',
};
const names: NameBook = (kind, id) => NAMES[`${kind}:${id}`];

describe('module catalog', () => {
  it('lists the modules in catalog order', () => {
    expect(MODULES.map((m) => m.id)).toEqual([
      'giver', 'objectives', 'dialogue', 'rewards', 'requirements', 'chain',
      'timer', 'behaviour', 'mapMarker', 'mail', 'extraRewards', 'advanced',
    ]);
    expect(MODULES.map((m) => m.label)).toEqual([
      'Quest Giver', 'Objectives', 'Dialogue', 'Rewards', 'Requirements', 'Chain',
      'Timer', 'Behaviour', 'Map marker', 'Mail reward', 'Extra rewards', 'Advanced',
    ]);
    expect(MODULES.filter((m) => m.kind === 'core').map((m) => m.id)).toEqual(['giver', 'objectives', 'dialogue', 'rewards']);
    for (const m of MODULES) expect(m.description.length).toBeGreaterThan(10);
  });

  it('gives every registry field exactly one owner', () => {
    for (const f of registry.fields) {
      const modules = MODULES.filter((m) => m.owns.includes(f.id)).length;
      const others = (HEADER_FIELDS.includes(f.id) ? 1 : 0) + (isHiddenField(f.id) ? 1 : 0);
      expect(modules + others, f.id).toBe(1);
    }
  });

  it('puts the known fields where the spec says', () => {
    expect(ownerOf('quest_template.LogTitle')).toBe('header');
    expect(ownerOf('quest_template.VerifiedBuild')).toBe('hidden');
    expect(ownerOf('quest_template_addon.ID')).toBe('hidden');
    expect(ownerOf('creature_queststarter')).toBe('giver');
    expect(ownerOf('creature_loot_template')).toBe('objectives');
    expect(ownerOf('areatrigger_involvedrelation')).toBe('objectives');
    expect(ownerOf('quest_offer_reward.Emotes')).toBe('dialogue');
    expect(ownerOf('quest_template.RewardFactions')).toBe('rewards');
    expect(ownerOf('quest_template.RequiredFactions')).toBe('requirements');
    expect(ownerOf('quest_template_addon.PrevQuestID')).toBe('chain');
    expect(ownerOf('quest_template.TimeAllowed')).toBe('timer');
    expect(ownerOf('quest_template_addon.SpecialFlags')).toBe('behaviour');
    expect(ownerOf('quest_poi')).toBe('mapMarker');
    expect(ownerOf('quest_mail_sender.RewardMailSenderEntry')).toBe('mail');
    expect(ownerOf('quest_template.RewardTalents')).toBe('extraRewards');
    expect(ownerOf('quest_template.QuestType')).toBe('advanced');
    expect(ownerOf('conditions')).toBe('advanced');
    expect(ownerOf('pool_quest')).toBe('advanced');
    expect(ownerOf('no.such')).toBeUndefined();
  });

  it('always shows the core modules and only the optional ones in use or added', () => {
    expect(presentModules({}, [])).toEqual(['giver', 'objectives', 'dialogue', 'rewards']);
    expect(presentModules({ 'quest_template.TimeAllowed': 900 }, ['chain'])).toEqual([
      'giver', 'objectives', 'dialogue', 'rewards', 'chain', 'timer',
    ]);
    expect(presentModules({ 'quest_template.QuestType': 2 }, [])).not.toContain('advanced');
    expect(presentModules({ 'quest_template.QuestType': 0 }, [])).toContain('advanced');
  });

  it('reports presence from owned values', () => {
    expect(isModulePresent('rewards', {})).toBe(false);
    expect(isModulePresent('rewards', { 'quest_template.RewardMoney': 100 })).toBe(true);
  });

  it('offers the optional modules not shown yet whose fields exist', () => {
    const values = { 'quest_template.TimeAllowed': 0, 'quest_template_addon.PrevQuestID': 0 };
    expect(offeredModules(values, [])).toEqual(['chain', 'timer']);
    expect(offeredModules(values, ['chain'])).toEqual(['timer']);
  });

  it('resets every owned field that is not read-only', () => {
    const values = { 'quest_template.TimeAllowed': 900, 'quest_template.RewardTalents': 2, 'quest_template.RewardHonor': 5 };
    expect(resetModule('timer', values, [])).toEqual({ 'quest_template.TimeAllowed': 0 });
    expect(resetModule('extraRewards', values, ['quest_template.RewardHonor'])).toEqual({ 'quest_template.RewardTalents': 0 });
  });
});

describe('module summaries', () => {
  const summary = (id: Parameters<typeof moduleById>[0], values: Record<string, unknown>) =>
    moduleById(id).summary(values as never, names);

  it('names who starts and ends the quest', () => {
    expect(summary('giver', {
      creature_queststarter: [{ id: 240 }], gameobject_queststarter: [{ id: 3000 }], creature_questender: [{ id: 7 }],
    })).toEqual(['Starts: Marshal Dughan, Wanted Poster', 'Ends: NPC #7']);
    expect(summary('giver', {})).toEqual([]);
  });

  it('lists objectives in kill, collect, explore order', () => {
    expect(summary('objectives', {
      'quest_template.RequiredNpcOrGo': [
        { target: { target: 'creature', id: 299 }, count: 10 },
        { target: { target: 'gameobject', id: 3000 }, count: 1 },
      ],
      'quest_template.RequiredItems': [{ item: 750, count: 5 }],
      areatrigger_involvedrelation: [{ id: 88 }],
    })).toEqual(['Kill 10 × Diseased Young Wolf', 'Use 1 × Wanted Poster', 'Collect 5 × Tough Wolf Meat', 'Explore area trigger 88']);
  });

  it('says which dialogue texts are written', () => {
    expect(summary('dialogue', { 'quest_template.QuestDescription': 'Hi', 'quest_offer_reward.RewardText': 'Thanks' }))
      .toEqual(['Written: Offer, Turn-in']);
    expect(summary('dialogue', { 'quest_template.QuestDescription': '' })).toEqual([]);
  });

  it('lists rewards', () => {
    expect(summary('rewards', {
      'quest_template.RewardXPDifficulty': 5,
      'quest_template.RewardMoney': 15025,
      'quest_template.RewardItems': [{ item: 750, amount: 2 }],
      'quest_template.RewardChoiceItems': [{ item: 750, quantity: 1 }, { item: 12, quantity: 1 }],
      'quest_template.RewardFactions': [{ faction: 529, value: 5, override: 0 }],
    })).toEqual(['XP tier 5', '1g 50s 25c', '2 × Tough Wolf Meat', 'Choice: Tough Wolf Meat, item #12', 'Argent Dawn reputation']);
  });

  it('summarises the timer as minutes and seconds', () => {
    expect(summary('timer', { 'quest_template.TimeAllowed': 905 })).toEqual(['15m 5s']);
  });

  it('summarises other optional modules by the labels of their set fields', () => {
    expect(summary('chain', { 'quest_template_addon.PrevQuestID': 12, 'quest_template_addon.ExclusiveGroup': 0 }))
      .toEqual([fieldById('quest_template_addon.PrevQuestID')!.label]);
  });

  it('formats money', () => {
    expect(formatMoney(0)).toBe('0c');
    expect(formatMoney(10000)).toBe('1g');
    expect(formatMoney(150)).toBe('1s 50c');
    expect(formatMoney(-500)).toBe('-5s');
  });
});

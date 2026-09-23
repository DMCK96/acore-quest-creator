import { fieldById, registry } from '../registry';
import type { FieldValue } from '../registry/types';
import type { ModuleDef, ModuleId, Values } from './model';
import {
  dialogueSummary,
  giverSummary,
  labelsSummary,
  objectivesSummary,
  rewardsSummary,
  timerSummary,
} from './summaries';
import { emptyValue, isUnset } from './values';

export { formatMoney } from './summaries';

/** Fields the quest header edits, owned by no module. */
export const HEADER_FIELDS: readonly string[] = [
  'quest_template.LogTitle',
  'quest_template.QuestLevel',
  'quest_template.MinLevel',
  'quest_template.QuestSortID',
];

/** Key and build columns: identifying values the user never edits, shown nowhere. */
export function isHiddenField(fieldId: string): boolean {
  return fieldId.endsWith('.ID') || fieldId.endsWith('.VerifiedBuild') || fieldId === 'quest_mail_sender.QuestId';
}

type Declared = Omit<ModuleDef, 'summary'> & { summary?: ModuleDef['summary'] };

const DECLARED: readonly Declared[] = [
  {
    id: 'giver',
    label: 'Quest Giver',
    description: 'Who offers the quest and who takes it back.',
    kind: 'core',
    owns: [
      'creature_queststarter',
      'gameobject_queststarter',
      'creature_questender',
      'gameobject_questender',
      'quest_template.StartItem',
      'quest_template_addon.ProvidedItemCount',
    ],
    summary: giverSummary,
  },
  {
    id: 'objectives',
    label: 'Objectives',
    description: 'What the player must kill, use, collect or explore.',
    kind: 'core',
    owns: [
      'quest_template.RequiredNpcOrGo',
      'quest_template.RequiredItems',
      'quest_template.ObjectiveText',
      'quest_template.ItemDrops',
      'quest_template.LogDescription',
      'areatrigger_involvedrelation',
      'creature_loot_template',
      'gameobject_loot_template',
      'creature_questitem',
      'gameobject_questitem',
    ],
    summary: objectivesSummary,
  },
  {
    id: 'dialogue',
    label: 'Dialogue',
    description: 'What the quest giver says when offering, checking and completing the quest.',
    kind: 'core',
    owns: [
      'quest_template.QuestDescription',
      'quest_template.QuestCompletionLog',
      'quest_request_items.CompletionText',
      'quest_request_items.EmoteOnComplete',
      'quest_request_items.EmoteOnIncomplete',
      'quest_offer_reward.RewardText',
      'quest_offer_reward.Emotes',
      'quest_details.Emotes',
    ],
    summary: (values) => dialogueSummary(values),
  },
  {
    id: 'rewards',
    label: 'Rewards',
    description: 'The experience, money, items and reputation the quest gives.',
    kind: 'core',
    owns: [
      'quest_template.RewardXPDifficulty',
      'quest_template.RewardMoney',
      'quest_template.RewardMoneyDifficulty',
      'quest_template.RewardItems',
      'quest_template.RewardChoiceItems',
      'quest_template.RewardFactions',
    ],
    summary: rewardsSummary,
  },
  {
    id: 'requirements',
    label: 'Requirements',
    description: 'Who can take the quest: level cap, races, classes, skills and reputation.',
    kind: 'optional',
    owns: [
      'quest_template_addon.MaxLevel',
      'quest_template.AllowableRaces',
      'quest_template_addon.AllowableClasses',
      'quest_template_addon.RequiredSkillID',
      'quest_template_addon.RequiredSkillPoints',
      'quest_template_addon.RequiredMinRepFaction',
      'quest_template_addon.RequiredMinRepValue',
      'quest_template_addon.RequiredMaxRepFaction',
      'quest_template_addon.RequiredMaxRepValue',
      'quest_template.RequiredFactions',
    ],
  },
  {
    id: 'chain',
    label: 'Chain',
    description: 'The quests that come before and after this one.',
    kind: 'optional',
    owns: [
      'quest_template_addon.PrevQuestID',
      'quest_template_addon.NextQuestID',
      'quest_template_addon.BreadcrumbForQuestId',
      'quest_template_addon.ExclusiveGroup',
      'quest_template.RewardNextQuest',
    ],
  },
  {
    id: 'timer',
    label: 'Timer',
    description: 'A time limit the quest fails after.',
    kind: 'optional',
    owns: ['quest_template.TimeAllowed'],
    summary: (values) => timerSummary(values),
  },
  {
    id: 'behaviour',
    label: 'Behaviour',
    description: 'Sharing, daily or weekly repeats, auto-complete and other quest flags.',
    kind: 'optional',
    owns: ['quest_template.Flags', 'quest_template_addon.SpecialFlags'],
  },
  {
    id: 'mapMarker',
    label: 'Map marker',
    description: 'Where the quest points on the world map.',
    kind: 'optional',
    owns: [
      'quest_poi',
      'quest_poi_points',
      'quest_template.POIContinent',
      'quest_template.POIx',
      'quest_template.POIy',
      'quest_template.POIPriority',
    ],
  },
  {
    id: 'mail',
    label: 'Mail reward',
    description: 'A letter sent to the player some time after the quest is done.',
    kind: 'optional',
    owns: [
      'quest_template_addon.RewardMailTemplateID',
      'quest_template_addon.RewardMailDelay',
      'quest_mail_sender.RewardMailSenderEntry',
    ],
  },
  {
    id: 'extraRewards',
    label: 'Extra rewards',
    description: 'Spells, titles, talents, honor and arena points.',
    kind: 'optional',
    owns: [
      'quest_template.RewardSpell',
      'quest_template.RewardDisplaySpell',
      'quest_template.RewardTitle',
      'quest_template.RewardTalents',
      'quest_template.RewardHonor',
      'quest_template.RewardKillHonor',
      'quest_template.RewardArenaPoints',
    ],
  },
];

/** Every registry field no other module, the header or the hidden set claims, in registry order. */
const claimed = new Set(DECLARED.flatMap((m) => m.owns));
const advancedOwns = registry.fields
  .map((f) => f.id)
  .filter((id) => !claimed.has(id) && !HEADER_FIELDS.includes(id) && !isHiddenField(id));

const ADVANCED: Declared = {
  id: 'advanced',
  label: 'Advanced',
  description: 'Every remaining column, edited raw, and the columns the tool does not model.',
  kind: 'optional',
  owns: advancedOwns,
};

export const MODULES: readonly ModuleDef[] = [...DECLARED, ADVANCED].map((m) => ({
  ...m,
  summary: m.summary ?? ((values: Values) => labelsSummary(m.owns, values)),
}));

const byId = new Map(MODULES.map((m) => [m.id, m]));
const owner = new Map(MODULES.flatMap((m) => m.owns.map((id) => [id, m.id] as const)));

export function moduleById(id: ModuleId): ModuleDef {
  return byId.get(id)!;
}

/** Which module (or the header, or nobody visible) edits a field; `undefined` for an unknown id. */
export function ownerOf(fieldId: string): ModuleId | 'header' | 'hidden' | undefined {
  if (HEADER_FIELDS.includes(fieldId)) return 'header';
  if (!fieldById(fieldId)) return undefined;
  if (isHiddenField(fieldId)) return 'hidden';
  return owner.get(fieldId);
}

/** True when any field the module owns holds something the user chose. */
export function isModulePresent(id: ModuleId, values: Values): boolean {
  return moduleById(id).owns.some((fieldId) => !isUnset(fieldId, values[fieldId]));
}

/** The modules shown for a quest: the core four always, then optional ones in use or just added. */
export function presentModules(values: Values, added: readonly ModuleId[]): ModuleId[] {
  return MODULES.filter((m) => m.kind === 'core' || added.includes(m.id) || isModulePresent(m.id, values)).map(
    (m) => m.id,
  );
}

/**
 * The optional modules "Add module" offers: not shown yet, and backed by at least one field.
 * Advanced is always offered, because the columns the tool does not model are shown there.
 */
export function offeredModules(values: Values, added: readonly ModuleId[]): ModuleId[] {
  const shown = new Set(presentModules(values, added));
  return MODULES.filter(
    (m) =>
      m.kind === 'optional' &&
      !shown.has(m.id) &&
      (m.id === 'advanced' || m.owns.some((id) => Object.prototype.hasOwnProperty.call(values, id))),
  ).map((m) => m.id);
}

/**
 * The edits that clear a module: each owned, writable field that holds something, back to its
 * empty value. A field that is already unset is left exactly as imported (NULL stays NULL).
 */
export function resetModule(id: ModuleId, values: Values, readOnly: readonly string[]): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {};
  for (const fieldId of moduleById(id).owns) {
    if (!Object.prototype.hasOwnProperty.call(values, fieldId) || readOnly.includes(fieldId)) continue;
    if (isUnset(fieldId, values[fieldId])) continue;
    const field = fieldById(fieldId);
    if (field) out[fieldId] = emptyValue(field);
  }
  return out;
}

import { fieldById } from '../registry';
import type { CreatureOrGoValue, ScalarValue } from '../registry/types';
import type { NameBook } from '../links/component';
import { factionName } from '../game/factions';
import { readGivers, type GiverTarget } from './givers';
import type { Values } from './model';
import { isUnset } from './values';
import { readScenes } from '../scripts/model';
import { readEntities } from '../entities/model';
import { describeScene } from '../scripts/describe';

/**
 * The one-line descriptions each module shows on its box and in the preview drawer. Every entity
 * is named from `names` when the editor has looked it up, and by kind and ID until then.
 */

type Row = Record<string, ScalarValue>;

const rowsOf = (values: Values, fieldId: string): Row[] => (values[fieldId] as Row[] | undefined) ?? [];
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0));

export function creatureName(id: number, names: NameBook): string {
  return names('creature', id) ?? `NPC #${id}`;
}

export function objectName(id: number, names: NameBook): string {
  return names('gameobject', id) ?? `Object #${id}`;
}

export function itemName(id: number, names: NameBook): string {
  return names('item', id) ?? `item #${id}`;
}

const giverName = (t: GiverTarget, names: NameBook): string =>
  t.kind === 'creature' ? creatureName(t.id, names) : objectName(t.id, names);

/** Copper as `1g 50s 25c`, leaving out the zero parts; zero itself is `0c`. */
export function formatMoney(copper: number): string {
  const sign = copper < 0 ? '-' : '';
  let rest = Math.abs(copper);
  const gold = Math.floor(rest / 10000);
  rest -= gold * 10000;
  const silver = Math.floor(rest / 100);
  const cop = rest - silver * 100;
  const parts = [gold && `${gold}g`, silver && `${silver}s`, cop && `${cop}c`].filter(Boolean);
  return parts.length === 0 ? '0c' : sign + parts.join(' ');
}

export function giverSummary(values: Values, names: NameBook): string[] {
  const lines: string[] = [];
  for (const [role, label] of [['start', 'Starts'], ['end', 'Ends']] as const) {
    const targets = readGivers(values, role).filter((t) => t.id !== 0);
    if (targets.length > 0) lines.push(`${label}: ${targets.map((t) => giverName(t, names)).join(', ')}`);
  }
  return lines;
}

export function objectivesSummary(values: Values, names: NameBook): string[] {
  const lines: string[] = [];
  for (const row of rowsOf(values, 'quest_template.RequiredNpcOrGo')) {
    const target = row.target as CreatureOrGoValue | null;
    if (!target || target.id === 0) continue;
    lines.push(
      target.target === 'creature'
        ? `Kill ${num(row.count)} × ${creatureName(target.id, names)}`
        : `Use ${num(row.count)} × ${objectName(target.id, names)}`,
    );
  }
  for (const row of rowsOf(values, 'quest_template.RequiredItems')) {
    if (num(row.item) === 0) continue;
    lines.push(`Collect ${num(row.count)} × ${itemName(num(row.item), names)}`);
  }
  for (const row of rowsOf(values, 'areatrigger_involvedrelation')) {
    if (num(row.id) !== 0) lines.push(`Explore area trigger ${num(row.id)}`);
  }
  return lines;
}

const DIALOGUE_TEXTS: ReadonlyArray<readonly [string, string]> = [
  ['quest_template.QuestDescription', 'Offer'],
  ['quest_request_items.CompletionText', 'Progress'],
  ['quest_offer_reward.RewardText', 'Turn-in'],
  ['quest_template.QuestCompletionLog', 'Log'],
];

export function dialogueSummary(values: Values): string[] {
  const written = DIALOGUE_TEXTS.filter(([id]) => !isUnset(id, values[id])).map(([, label]) => label);
  return written.length === 0 ? [] : [`Written: ${written.join(', ')}`];
}

/** How many new NPCs and objects, then the first two names. */
export function entitiesSummary(values: Values): string[] {
  const { npcs, objects } = readEntities(values);
  if (npcs.length + objects.length === 0) return [];
  const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
  const names = [...npcs, ...objects].map((e) => e.name.trim() || `#${e.entry}`).slice(0, 2);
  return [`${count(npcs.length, 'NPC', 'NPCs')}, ${count(objects.length, 'object', 'objects')}`, ...names];
}

/** How many scenes, then the first two in words. */
export function scriptsSummary(values: Values): string[] {
  const scenes = readScenes(values);
  if (scenes.length === 0) return [];
  return [`${scenes.length} ${scenes.length === 1 ? 'scene' : 'scenes'}`, ...scenes.slice(0, 2).map(describeScene)];
}

export function rewardsSummary(values: Values, names: NameBook): string[] {
  const lines: string[] = [];
  const xp = num(values['quest_template.RewardXPDifficulty']);
  if (xp) lines.push(`XP tier ${xp}`);
  const money = num(values['quest_template.RewardMoney']);
  const moneyTier = num(values['quest_template.RewardMoneyDifficulty']);
  if (moneyTier >= 1 && moneyTier <= 9 && money >= 0) lines.push(`Money scales with level (tier ${moneyTier})`);
  else if (money) lines.push(formatMoney(money));
  for (const row of rowsOf(values, 'quest_template.RewardItems')) {
    if (num(row.item) !== 0) lines.push(`${num(row.amount)} × ${itemName(num(row.item), names)}`);
  }
  const choices = rowsOf(values, 'quest_template.RewardChoiceItems').filter((r) => num(r.item) !== 0);
  if (choices.length > 0) lines.push(`Choice: ${choices.map((r) => itemName(num(r.item), names)).join(', ')}`);
  for (const row of rowsOf(values, 'quest_template.RewardFactions')) {
    const id = num(row.faction);
    if (id !== 0) lines.push(`${factionName(id) ?? `faction #${id}`} reputation`);
  }
  return lines;
}

export function timerSummary(values: Values): string[] {
  const seconds = num(values['quest_template.TimeAllowed']);
  if (!seconds) return [];
  return [`${Math.floor(seconds / 60)}m ${seconds % 60}s`];
}

/** The registry labels of the owned fields that hold something, for modules with no richer summary. */
export function labelsSummary(owns: readonly string[], values: Values): string[] {
  return owns.filter((id) => !isUnset(id, values[id])).map((id) => fieldById(id)?.label ?? id);
}

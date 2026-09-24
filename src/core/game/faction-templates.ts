import { dbcString, parseDbc } from './dbc';

/**
 * The factions an NPC can belong to. A creature's `faction` is a `FactionTemplate.dbc` id, named by
 * the `Faction.dbc` row it points at, and its masks say who it is friendly and hostile to.
 */

export const FACTION_TEMPLATE_FILES = { templates: 'FactionTemplate.dbc', factions: 'Faction.dbc' } as const;

/** The templates most new NPCs want, offered as one click each. */
export const COMMON_FACTIONS: readonly { id: number; label: string }[] = [
  { id: 35, label: 'Friendly to all' },
  { id: 14, label: 'Hostile to all' },
  { id: 11, label: 'Stormwind' },
  { id: 85, label: 'Orgrimmar' },
  { id: 7, label: 'Monster' },
];

export interface FactionTemplateIndex {
  search(text: string, limit: number): { id: number; name: string; detail: string }[];
  get(id: number): { name: string; detail: string } | undefined;
}

/** Faction group mask bits, in the order they are named. */
const GROUPS: readonly [number, string][] = [[1, 'players'], [2, 'Alliance'], [4, 'Horde'], [8, 'monsters']];

const list = (words: string[]): string =>
  words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
const groupsIn = (mask: number): string[] => GROUPS.filter(([bit]) => (mask & bit) !== 0).map(([, word]) => word);

/** Who a template is friendly and hostile to, in words. */
export function reactionOf(masks: { friendly: number; hostile: number }): string {
  const parts: string[] = [];
  const friendly = groupsIn(masks.friendly);
  const hostile = groupsIn(masks.hostile);
  if (friendly.length > 0) parts.push(`friendly to ${list(friendly)}`);
  if (hostile.length > 0) parts.push(`hostile to ${list(hostile)}`);
  return parts.length > 0 ? parts.join('; ') : 'neutral';
}

/** `FactionTemplate` 0 id, 1 faction, 4 friendly mask, 5 hostile mask; `Faction` 0 id, 23 name. */
export function readFactionTemplates(files: { templates: Uint8Array; factions: Uint8Array }): FactionTemplateIndex {
  const names = new Map(parseDbc(files.factions, FACTION_TEMPLATE_FILES.factions).records.map((r) => [r[0]!, dbcString(files.factions, r[23]!)]));
  const templates = new Map<number, { name: string; detail: string }>();
  for (const r of parseDbc(files.templates, FACTION_TEMPLATE_FILES.templates).records) {
    templates.set(r[0]!, { name: names.get(r[1]!) || `Faction ${r[1]}`, detail: reactionOf({ friendly: r[4]!, hostile: r[5]! }) });
  }
  const byId = [...templates.entries()].sort(([a], [b]) => a - b);
  return {
    get: (id) => templates.get(id),
    search(text, limit) {
      const needle = text.trim().toLowerCase();
      if (needle === '') return [];
      if (/^\d+$/.test(needle) && templates.has(Number(needle))) return [{ id: Number(needle), ...templates.get(Number(needle))! }];
      return byId.filter(([, t]) => t.name.toLowerCase().includes(needle)).slice(0, limit).map(([id, t]) => ({ id, ...t }));
    },
  };
}

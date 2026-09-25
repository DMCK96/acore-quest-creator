import { dbcString, parseDbc } from './dbc';
import { AREA_TABLE_FILE, MAP_FILE, parseMapNames } from './maps-dbc';

/**
 * Where a quest is listed in the player's quest log: `QuestSortID`. A positive value is a zone from
 * `AreaTable.dbc` (the log lists the quest under "Elwynn Forest"); a negative value is a category
 * from `QuestSort.dbc` with its sign flipped (under "Warrior" or "Seasonal"). Both are searched
 * and named as one list, so the stored value is picked by name and never needs a mode switch.
 */

export const QUEST_SORT_FILE = 'QuestSort.dbc';
export const QUEST_SORT_FILES = [AREA_TABLE_FILE, MAP_FILE, QUEST_SORT_FILE] as const;

/**
 * The categories of stock 3.3.5, from `enum QuestSort` in `src/server/shared/SharedDefines.h`, used
 * when the server data folder has no `QuestSort.dbc`. IDs are positive, as in the DBC.
 */
export const QUEST_SORT_CATEGORIES: readonly { id: number; name: string }[] = [
  { id: 1, name: 'Epic' },
  { id: 21, name: 'Wailing Caverns (old)' },
  { id: 22, name: 'Seasonal' },
  { id: 23, name: 'Undercity (old)' },
  { id: 24, name: 'Herbalism' },
  { id: 25, name: 'Battlegrounds' },
  { id: 41, name: "Uldaman (old)" },
  { id: 61, name: 'Warlock' },
  { id: 81, name: 'Warrior' },
  { id: 82, name: 'Shaman' },
  { id: 101, name: 'Fishing' },
  { id: 121, name: 'Blacksmithing' },
  { id: 141, name: 'Paladin' },
  { id: 161, name: 'Mage' },
  { id: 162, name: 'Rogue' },
  { id: 181, name: 'Alchemy' },
  { id: 182, name: 'Leatherworking' },
  { id: 201, name: 'Engineering' },
  { id: 221, name: 'Treasure Map' },
  { id: 241, name: 'Sunken Temple (old)' },
  { id: 261, name: 'Hunter' },
  { id: 262, name: 'Priest' },
  { id: 263, name: 'Druid' },
  { id: 264, name: 'Tailoring' },
  { id: 284, name: 'Special' },
  { id: 304, name: 'Cooking' },
  { id: 324, name: 'First Aid' },
  { id: 344, name: 'Legendary' },
  { id: 364, name: 'Darkmoon Faire' },
  { id: 365, name: "Ahn'Qiraj War" },
  { id: 366, name: 'Lunar Festival' },
  { id: 367, name: 'Reputation' },
  { id: 368, name: 'Invasion' },
  { id: 369, name: 'Midsummer Fire Festival' },
  { id: 370, name: 'Brewfest' },
  { id: 371, name: 'Inscription' },
  { id: 372, name: 'Death Knight' },
  { id: 373, name: 'Jewelcrafting' },
  { id: 374, name: 'Noblegarden' },
  { id: 375, name: "Pilgrim's Bounty" },
  { id: 376, name: 'Love is in the Air' },
];

export interface QuestSortHit {
  id: number;
  name: string;
  detail: string;
}

export interface QuestSortIndex {
  search(text: string, limit: number): QuestSortHit[];
  get(id: number): string | undefined;
}

/** `AreaTable` 0 id, 1 map, 2 parent area, 11 enUS name; `QuestSort` 0 id, 1 enUS name. */
export function readQuestSorts(files: { areas?: Uint8Array; maps?: Uint8Array; sorts?: Uint8Array }): QuestSortIndex {
  const mapNames = files.maps ? parseMapNames(files.maps) : new Map<number, { name: string }>();
  const zones = new Map<number, { name: string; topLevel: boolean; map: number }>();
  if (files.areas) {
    for (const r of parseDbc(files.areas, AREA_TABLE_FILE).records) {
      const name = dbcString(files.areas, r[11]!);
      if (name) zones.set(r[0]!, { name, topLevel: r[2] === 0, map: r[1]! });
    }
  }
  const categories = new Map<number, string>(
    files.sorts
      ? parseDbc(files.sorts, QUEST_SORT_FILE).records.map((r) => [r[0]!, dbcString(files.sorts!, r[1]!)] as const).filter(([, n]) => n)
      : QUEST_SORT_CATEGORIES.map((c) => [c.id, c.name] as const),
  );

  const zoneHit = (id: number): QuestSortHit => {
    const zone = zones.get(id);
    if (!zone) return { id, name: `Zone ${id}`, detail: 'Zone' };
    const map = mapNames.get(zone.map)?.name;
    return { id, name: zone.name, detail: map ? `Zone in ${map}` : 'Zone' };
  };
  const categoryHit = (id: number, name: string): QuestSortHit => ({ id: -id, name, detail: 'Category' });

  // Categories first (a short list), then zones; names that start with the text before the rest.
  const byName = [
    ...[...categories].map(([id, name]) => categoryHit(id, name)),
    ...[...zones].filter(([, z]) => z.topLevel).map(([id]) => zoneHit(id)),
  ];

  return {
    get(id) {
      if (id > 0) return zones.get(id)?.name ?? (zones.size === 0 ? `Zone ${id}` : undefined);
      if (id < 0) return categories.get(-id);
      return undefined;
    },
    search(text, limit) {
      const needle = text.trim().toLowerCase();
      if (needle === '') return [];
      if (/^-\d+$/.test(needle)) {
        const name = categories.get(-Number(needle));
        return name ? [categoryHit(-Number(needle), name)] : [];
      }
      if (/^\d+$/.test(needle)) {
        const id = Number(needle);
        // Without AreaTable any zone ID is taken on trust, shown by its number.
        return zones.has(id) || zones.size === 0 ? [zoneHit(id)] : [];
      }
      const matches = byName.filter((h) => h.name.toLowerCase().includes(needle));
      const starts = matches.filter((h) => h.name.toLowerCase().startsWith(needle));
      return [...starts, ...matches.filter((h) => !starts.includes(h))].slice(0, limit);
    },
  };
}

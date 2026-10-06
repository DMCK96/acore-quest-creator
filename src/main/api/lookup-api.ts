import type { RawRow, RefKind } from '../../core/db/types';
import { UnknownColumnError, UnknownTableError, type WorldDb } from '../../core/db/world-db';
import { registry } from '../../core/registry';
import type { LookupApi, SpellFactsResult } from '../../shared/ipc';
import { spellDetail, spellLabel } from '../../core/game/spells';
import type { Services } from './services';
import { run } from './errors';
import { ENTITY_SEARCH_LIMIT } from './server-files';

const SEARCH_LIMIT = 50;

const REWARD_TIERS = 10;
const REWARD_LEVEL_MIN = 1;
const REWARD_LEVEL_MAX = 80;
const INTEGER_TEXT = /^-?\d+$/;

/** Reads text that must be a plain integer; anything else (garbage, missing) is `null`. */
function parseRewardInt(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || !INTEGER_TEXT.test(raw)) return null;
  return Number(raw);
}

/**
 * Fetches the one row keyed by `level`, tolerating a table or column the connected schema does not
 * have at all (drift outside the registry): both come back as "no row", not an error.
 */
async function readRewardRow(
  db: WorldDb,
  table: string,
  keyColumn: string,
  level: number,
): Promise<RawRow | undefined> {
  try {
    const rows = await db.selectRows(table, { [keyColumn]: [String(level)] });
    return rows[0];
  } catch (error) {
    if (error instanceof UnknownTableError || error instanceof UnknownColumnError) return undefined;
    throw error;
  }
}

/** Searches and names: quests, NPCs, objects, items, spells, sounds, looks, rewards and events */
export function createLookupApi(s: Services): LookupApi {
  const { connected, projectEntities } = s.ctx;
  const { spellsOf, soundsOf, questSortsOf, lookOf, isLookKind, lookHits } = s.files;

  return {
    searchQuests: (text) => run(async () => connected().db.searchQuests(text, SEARCH_LIMIT)),
    searchEntities: (kind, text) =>
      run(async () => {
        if (kind === 'sound') {
          const sounds = await soundsOf(connected());
          return 'reason' in sounds ? [] : sounds.search(text, ENTITY_SEARCH_LIMIT);
        }
        if (isLookKind(kind)) return lookHits(connected(), kind, text);
        if (kind === 'questSort') return (await questSortsOf(connected())).search(text, ENTITY_SEARCH_LIMIT);
        if (kind === 'spell') {
          const spells = await spellsOf(connected());
          if ('reason' in spells) return [];
          return spells.search(text, ENTITY_SEARCH_LIMIT).map((f) => ({ id: f.id, name: spellLabel(f), detail: spellDetail(f) }));
        }
        const found = await connected().db.searchEntities(kind, text, ENTITY_SEARCH_LIMIT);
        if (kind !== 'creature' && kind !== 'gameobject' && kind !== 'item') return found;
        const { npcs, objects, items } = projectEntities();
        const needle = text.trim().toLowerCase();
        if (needle === '') return found;
        const word = { creature: 'NPC', gameobject: 'object', item: 'item' }[kind];
        const mine = (kind === 'creature' ? npcs : kind === 'gameobject' ? objects : items)
          .filter((e) => e.name.toLowerCase().includes(needle) || String(e.entry) === needle)
          .map((e) => ({ id: e.entry, name: e.name || `New ${word} ${e.entry}`, detail: 'new' }));
        const ids = new Set(mine.map((h) => h.id));
        return [...mine, ...found.filter((h) => !ids.has(h.id))].slice(0, ENTITY_SEARCH_LIMIT);
      }),

    lookupNames: (kind: RefKind, ids) =>
      run(async () => {
        if (isLookKind(kind)) {
          const index = await lookOf(connected(), kind);
          const names: Record<number, string> = {};
          if ('reason' in index) return names;
          for (const id of ids) {
            const found = index.get(id);
            if (found !== undefined) names[id] = typeof found === 'string' ? found : found.name;
          }
          return names;
        }
        if (kind === 'questSort') {
          const index = await questSortsOf(connected());
          const names: Record<number, string> = {};
          for (const id of ids) {
            const name = index.get(id);
            if (name !== undefined) names[id] = name;
          }
          return names;
        }
        if (kind === 'sound') {
          const sounds = await soundsOf(connected());
          const names: Record<number, string> = {};
          if ('reason' in sounds) return names;
          for (const id of ids) {
            const name = sounds.get(id);
            if (name !== undefined) names[id] = name;
          }
          return names;
        }
        if (kind === 'spell') {
          const spells = await spellsOf(connected());
          const names: Record<number, string> = {};
          if ('reason' in spells) return names;
          for (const id of ids) {
            const spell = spells.get(id);
            if (spell) names[id] = spellLabel(spell);
          }
          return names;
        }
        const found = await connected().db.lookupNames(kind, ids);
        // New NPCs, objects and items are not in the database until the quest is applied.
        const { npcs, objects, items } = projectEntities();
        const mine = kind === 'creature' ? npcs : kind === 'gameobject' ? objects : kind === 'item' ? items : [];
        for (const entity of mine) if (ids.includes(entity.entry) && !found.has(entity.entry)) found.set(entity.entry, entity.name || `#${entity.entry}`);
        const names: Record<number, string> = {};
        for (const [id, name] of found) names[id] = name;
        return names;
      }),

    // `xp[i]` is `questxp_dbc.Difficulty_{i+1}` and `money[i]` is `quest_money_reward.Money{i}`,
    // both for the row keyed by `level`; a missing row/table/column or an out-of-range level is
    // all-null rather than an error, since a fork can lack these reference tables entirely.
    // `questxp_dbc` only overrides QuestXP.dbc and is usually empty, so without a row the XP comes
    // from the server data folder's QuestXP.dbc when the profile names one.
    rewardTables: (level) =>
      run(async () => {
        const live = connected();
        const nulls = { xp: Array(REWARD_TIERS).fill(null), money: Array(REWARD_TIERS).fill(null) };
        if (!Number.isInteger(level) || level < REWARD_LEVEL_MIN || level > REWARD_LEVEL_MAX) return nulls;

        const xpRow = await readRewardRow(live.db, 'questxp_dbc', 'ID', level);
        const moneyRow = await readRewardRow(live.db, 'quest_money_reward', 'Level', level);
        const dbcXp = live.serverData?.questXp?.get(level);
        const xp = Array.from({ length: REWARD_TIERS }, (_, i) =>
          xpRow ? parseRewardInt(xpRow[`Difficulty_${i + 1}`]) : (dbcXp?.[i] ?? null),
        );
        const money = Array.from({ length: REWARD_TIERS }, (_, i) =>
          moneyRow ? parseRewardInt(moneyRow[`Money${i}`]) : null,
        );
        return { xp, money };
      }),

    spellFacts: (ids) =>
      run(async (): Promise<SpellFactsResult> => {
        const spells = await spellsOf(connected());
        if ('reason' in spells) return { available: false, reason: spells.reason, spells: {} };
        const found: SpellFactsResult['spells'] = {};
        for (const id of ids) {
          const spell = spells.get(id);
          if (spell) found[id] = spell;
        }
        return { available: true, spells: found };
      }),

    gameEvents: () =>
      run(async () => {
        const db = connected().db;
        if ((await db.columns('game_event')).length === 0) return [];
        return (await db.selectRows('game_event', {}))
          .map((row) => ({ id: Number(row.eventEntry), name: row.description ?? '' }))
          .filter((e) => Number.isInteger(e.id) && e.id > 0)
          .sort((a, b) => a.id - b.id);
      }),
  };
}

import { rowsOrNone } from '../db/rows-or-none';
import type { RawRow } from '../db/types';
import type { WorldDb } from '../db/world-db';
import type { NamedRef, QuestSummaries, QuestSummary, ZoneQuest, ZoneQuests } from './types';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const STARTERS_IN_ZONE_LIST = 3;
const GIVERS_IN_SUMMARY = 5;
const TEXT_LIMIT = 1500;
const FLAG_DAILY = 0x1000;
const FLAG_WEEKLY = 0x8000;

const num = (row: RawRow | undefined, column: string): number => Number(row?.[column] ?? 0) || 0;
const text = (row: RawRow | undefined, column: string): string => row?.[column] ?? '';
const cut = (value: string): string => (value.length > TEXT_LIMIT ? `${value.slice(0, TEXT_LIMIT)}…` : value);
const repeatableOf = (flags: number): 'daily' | 'weekly' | null => (flags & FLAG_DAILY ? 'daily' : flags & FLAG_WEEKLY ? 'weekly' : null);
const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);

/** Who starts (or ends) each quest: creatures, then objects, each named. */
async function givers(db: WorldDb, side: 'starter' | 'ender', questIds: number[], perQuest: number): Promise<Map<number, NamedRef[]>> {
  const ids = questIds.map(String);
  const [creatureRows, objectRows] = await Promise.all([
    rowsOrNone(db, `creature_quest${side}`, { quest: ids }),
    rowsOrNone(db, `gameobject_quest${side}`, { quest: ids }),
  ]);
  const [creatureNames, objectNames] = await Promise.all([
    db.lookupNames('creature', [...new Set(creatureRows.map((r) => num(r, 'id')))]),
    db.lookupNames('gameobject', [...new Set(objectRows.map((r) => num(r, 'id')))]),
  ]);
  const out = new Map<number, NamedRef[]>();
  const add = (quest: number, ref: NamedRef): void => {
    const list = out.get(quest) ?? [];
    if (list.length < perQuest) list.push(ref);
    out.set(quest, list);
  };
  for (const r of creatureRows) add(num(r, 'quest'), { kind: 'creature', id: num(r, 'id'), name: creatureNames.get(num(r, 'id')) ?? '' });
  for (const r of objectRows) add(num(r, 'quest'), { kind: 'gameobject', id: num(r, 'id'), name: objectNames.get(num(r, 'id')) ?? '' });
  return out;
}

/** The quests listed under a zone (`QuestSortID`), by level, optionally within a level range. */
export async function questsInZone(
  db: WorldDb,
  zone: { id: number; name: string },
  filter: { minLevel?: number; maxLevel?: number; limit?: number },
): Promise<ZoneQuests> {
  const rows = await db.selectRows('quest_template', { QuestSortID: [String(zone.id)] });
  const { minLevel = -Infinity, maxLevel = Infinity } = filter;
  const kept = rows.filter((r) => {
    const level = num(r, 'QuestLevel');
    return level === -1 || (level >= minLevel && level <= maxLevel);
  });
  // A quest that scales to the player sorts after the rest
  const rank = (r: RawRow): number => (num(r, 'QuestLevel') === -1 ? Infinity : num(r, 'QuestLevel'));
  kept.sort((a, b) => (rank(a) === rank(b) ? num(a, 'ID') - num(b, 'ID') : rank(a) < rank(b) ? -1 : 1));

  const limit = Math.min(Math.max(filter.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const shown = kept.slice(0, limit);
  const starters = await givers(db, 'starter', shown.map((r) => num(r, 'ID')), STARTERS_IN_ZONE_LIST);
  const quests: ZoneQuest[] = shown.map((r) => ({
    id: num(r, 'ID'),
    title: text(r, 'LogTitle'),
    level: num(r, 'QuestLevel'),
    minLevel: num(r, 'MinLevel'),
    repeatable: repeatableOf(num(r, 'Flags')),
    starters: starters.get(num(r, 'ID')) ?? [],
  }));
  return { zone, quests, total: kept.length, truncated: kept.length > shown.length };
}

/** Quests read as text and facts, without importing them into the project. */
export async function questSummaries(db: WorldDb, ids: number[], zoneName: (id: number) => string | undefined): Promise<QuestSummaries> {
  const keys = ids.map(String);
  const [templates, addons, rewards, requests] = await Promise.all([
    db.selectRows('quest_template', { ID: keys }),
    rowsOrNone(db, 'quest_template_addon', { ID: keys }),
    rowsOrNone(db, 'quest_offer_reward', { ID: keys }),
    rowsOrNone(db, 'quest_request_items', { ID: keys }),
  ]);
  const byId = (rows: RawRow[]): Map<number, RawRow> => new Map(rows.map((r) => [num(r, 'ID'), r]));
  const [template, addon, reward, request] = [byId(templates), byId(addons), byId(rewards), byId(requests)];
  const found = ids.filter((id) => template.has(id));
  const missing = ids.filter((id) => !template.has(id));

  // Every id that needs a name, by kind, asked for once
  const wanted = { creature: new Set<number>(), gameobject: new Set<number>(), item: new Set<number>() };
  for (const id of found) {
    const row = template.get(id)!;
    for (const n of range(4)) {
      const target = num(row, `RequiredNpcOrGo${n}`);
      if (target > 0) wanted.creature.add(target);
      if (target < 0) wanted.gameobject.add(-target);
    }
    for (const n of range(6)) {
      wanted.item.add(num(row, `RequiredItemId${n}`));
      wanted.item.add(num(row, `RewardChoiceItemID${n}`));
    }
    for (const n of range(4)) wanted.item.add(num(row, `RewardItem${n}`));
  }
  wanted.item.delete(0);
  const [creatureNames, objectNames, itemNames] = await Promise.all([
    db.lookupNames('creature', [...wanted.creature]),
    db.lookupNames('gameobject', [...wanted.gameobject]),
    db.lookupNames('item', [...wanted.item]),
  ]);
  const [starters, enders] = await Promise.all([givers(db, 'starter', found, GIVERS_IN_SUMMARY), givers(db, 'ender', found, GIVERS_IN_SUMMARY)]);

  const quests: QuestSummary[] = found.map((id) => {
    const t = template.get(id)!;
    const sort = num(t, 'QuestSortID');
    const a = addon.get(id);
    return {
      id,
      title: text(t, 'LogTitle'),
      level: num(t, 'QuestLevel'),
      minLevel: num(t, 'MinLevel'),
      zone: sort > 0 ? { id: sort, name: zoneName(sort) ?? `Zone ${sort}` } : null,
      repeatable: repeatableOf(num(t, 'Flags')),
      text: {
        objectives: cut(text(t, 'LogDescription')),
        details: cut(text(t, 'QuestDescription')),
        reward: cut(text(reward.get(id), 'RewardText')),
        requestItems: cut(text(request.get(id), 'CompletionText')),
        completion: cut(text(t, 'QuestCompletionLog')),
      },
      objectives: [
        ...range(4).flatMap((n): QuestSummary['objectives'] => {
          const target = num(t, `RequiredNpcOrGo${n}`);
          const count = num(t, `RequiredNpcOrGoCount${n}`);
          if (target === 0) return [];
          return target > 0
            ? [{ kind: 'creature' as const, id: target, name: creatureNames.get(target) ?? '', count }]
            : [{ kind: 'gameobject' as const, id: -target, name: objectNames.get(-target) ?? '', count }];
        }),
        ...range(6).flatMap((n) => {
          const item = num(t, `RequiredItemId${n}`);
          return item === 0 ? [] : [{ kind: 'item' as const, id: item, name: itemNames.get(item) ?? '', count: num(t, `RequiredItemCount${n}`) }];
        }),
      ],
      rewards: {
        money: num(t, 'RewardMoney'),
        items: range(4).flatMap((n) => {
          const item = num(t, `RewardItem${n}`);
          return item === 0 ? [] : [{ id: item, name: itemNames.get(item) ?? '', count: num(t, `RewardAmount${n}`) }];
        }),
        choices: range(6).flatMap((n) => {
          const item = num(t, `RewardChoiceItemID${n}`);
          return item === 0 ? [] : [{ id: item, name: itemNames.get(item) ?? '', count: num(t, `RewardChoiceItemQuantity${n}`) }];
        }),
        reputation: range(5).flatMap((n) => {
          const faction = num(t, `RewardFactionID${n}`);
          return faction === 0 ? [] : [{ faction, value: num(t, `RewardFactionValue${n}`) }];
        }),
      },
      starters: starters.get(id) ?? [],
      enders: enders.get(id) ?? [],
      chain: { previous: num(a, 'PrevQuestID'), next: num(a, 'NextQuestID'), exclusiveGroup: num(a, 'ExclusiveGroup'), breadcrumbFor: num(a, 'BreadcrumbForQuestId') },
    };
  });
  return { quests, missing };
}

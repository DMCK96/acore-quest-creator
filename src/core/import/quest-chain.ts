import type { RawRow, Where } from '../db/types';
import { UnknownColumnError, UnknownTableError, type WorldDb } from '../db/world-db';

/**
 * Every quest connected to one quest through the columns the server uses to chain quests.
 *
 * A quest names its neighbours in both directions, and a chain is usually only written down in one
 * of them: quest B says `PrevQuestID = A`, while A says nothing about B. So each step asks both
 * "who does this quest point at" and "who points at this quest", until nothing new turns up.
 *
 * - `quest_template_addon.PrevQuestID` — the parent; negative means "active", still the parent.
 * - `quest_template_addon.NextQuestID` and `quest_template.RewardNextQuest` — a child.
 * - `quest_template_addon.BreadcrumbForQuestId` — the breadcrumb leads into its target.
 * - `quest_template_addon.ExclusiveGroup` — every quest sharing a non-zero group is a sibling.
 */

/** A parent-to-child edge between two quests of the chain. */
export interface ChainLink {
  from: number;
  to: number;
}

export interface QuestChain {
  /** The starting quest first, then the rest in the order they were found. */
  questIds: number[];
  links: ChainLink[];
  /** True when the walk stopped at `limit` with more quests still to visit. */
  truncated: boolean;
}

/** Enough for any real chain; a runaway walk through a huge exclusive group stops here. */
export const MAX_CHAIN_QUESTS = 100;

const ADDON = 'quest_template_addon';
const TEMPLATE = 'quest_template';

const idOf = (raw: string | null | undefined): number => {
  if (raw === null || raw === undefined || !/^-?\d+$/.test(raw)) return 0;
  return Number(raw);
};

/** A fork without the table or column simply has no links of that kind. */
async function rowsOrNone(db: WorldDb, table: string, where: Where): Promise<RawRow[]> {
  const values = Object.values(where);
  if (values.some((v) => typeof v !== 'string' && v.length === 0)) return [];
  try {
    return await db.selectRows(table, where);
  } catch (error) {
    if (error instanceof UnknownTableError || error instanceof UnknownColumnError) return [];
    throw error;
  }
}

export async function findQuestChain(db: WorldDb, questId: number, limit = MAX_CHAIN_QUESTS): Promise<QuestChain> {
  const found: number[] = [questId];
  const seen = new Set<number>(found);
  const seenGroups = new Set<number>();
  const links = new Map<string, ChainLink>();
  let frontier = [questId];
  let truncated = false;

  const link = (from: number, to: number): void => {
    if (from > 0 && to > 0 && from !== to) links.set(`${from}>${to}`, { from, to });
  };

  while (frontier.length > 0) {
    const ids = frontier.map(String);
    const negated = frontier.map((id) => String(-id));
    const [addonOwn, templateOwn, prevOf, nextOf, crumbsOf, rewardOf] = await Promise.all([
      rowsOrNone(db, ADDON, { ID: ids }),
      rowsOrNone(db, TEMPLATE, { ID: ids }),
      rowsOrNone(db, ADDON, { PrevQuestID: [...ids, ...negated] }),
      rowsOrNone(db, ADDON, { NextQuestID: ids }),
      rowsOrNone(db, ADDON, { BreadcrumbForQuestId: ids }),
      rowsOrNone(db, TEMPLATE, { RewardNextQuest: ids }),
    ]);

    const candidates: number[] = [];
    const groups: number[] = [];
    for (const row of addonOwn) {
      const id = idOf(row.ID);
      const prev = Math.abs(idOf(row.PrevQuestID));
      const next = idOf(row.NextQuestID);
      const crumb = idOf(row.BreadcrumbForQuestId);
      const group = idOf(row.ExclusiveGroup);
      if (prev) (link(prev, id), candidates.push(prev));
      if (next) (link(id, next), candidates.push(next));
      if (crumb) (link(id, crumb), candidates.push(crumb));
      if (group && !seenGroups.has(group)) (seenGroups.add(group), groups.push(group));
    }
    for (const row of templateOwn) {
      const next = idOf(row.RewardNextQuest);
      if (next) (link(idOf(row.ID), next), candidates.push(next));
    }
    for (const row of prevOf) (link(Math.abs(idOf(row.PrevQuestID)), idOf(row.ID)), candidates.push(idOf(row.ID)));
    for (const row of nextOf) (link(idOf(row.ID), idOf(row.NextQuestID)), candidates.push(idOf(row.ID)));
    for (const row of crumbsOf) (link(idOf(row.ID), idOf(row.BreadcrumbForQuestId)), candidates.push(idOf(row.ID)));
    for (const row of rewardOf) (link(idOf(row.ID), idOf(row.RewardNextQuest)), candidates.push(idOf(row.ID)));
    if (groups.length > 0) {
      for (const row of await rowsOrNone(db, ADDON, { ExclusiveGroup: groups.map(String) })) candidates.push(idOf(row.ID));
    }

    // A column can name a quest that was never created; only quests that exist join the chain.
    const fresh = [...new Set(candidates)].filter((id) => id > 0 && !seen.has(id));
    const existing = new Set(
      (await rowsOrNone(db, TEMPLATE, { ID: fresh.map(String) })).map((row) => idOf(row.ID)),
    );
    frontier = [];
    for (const id of fresh) {
      seen.add(id);
      if (!existing.has(id)) continue;
      if (found.length >= limit) {
        truncated = true;
        continue;
      }
      found.push(id);
      frontier.push(id);
    }
  }

  const inChain = new Set(found);
  return {
    questIds: found,
    links: [...links.values()].filter((l) => inChain.has(l.from) && inChain.has(l.to)),
    truncated,
  };
}

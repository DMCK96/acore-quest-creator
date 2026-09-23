import type { RawRow, Where } from '../db/types';
import { UnknownColumnError, UnknownTableError, type WorldDb } from '../db/world-db';
import { ACTION } from '../smartai/ids';
import { readWorldFacts, type QuestFacts } from '../links/facts';
import { readLinkContext, type ItemStarter } from '../links/context';
import { recogniseLinks } from '../links/recognise';
import { questEdges, type ComponentId } from '../links/model';
import { CATALOG } from '../links/catalog';

/**
 * Every quest connected to one quest through the components the link model recognises: quest-column
 * chains, exclusive groups, and any mechanism (item, SmartAI, condition, ...) the catalog knows how
 * to read. The catalog is the one definition of what counts as a link; the columns themselves are no
 * longer listed here.
 *
 * A quest names its neighbours in both directions, and a chain is usually only written down in one
 * of them: quest B says `PrevQuestID = A`, while A says nothing about B. So each step asks both
 * "who does this quest point at" and "who points at this quest", until nothing new turns up. A quest
 * can also be linked only through a script — turning in quest A makes a SmartAI row offer quest B —
 * so the reverse read also follows `readLinkContext`'s script rows, not just the reverse columns.
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

export async function findQuestChain(
  db: WorldDb,
  questId: number,
  limit = MAX_CHAIN_QUESTS,
  available?: ReadonlySet<ComponentId>,
  /** The session's item starters, so a walk of many steps never scans `item_template` per step. */
  itemStarters?: readonly ItemStarter[],
): Promise<QuestChain> {
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

    const frontierFacts = await readWorldFacts(db, frontier);

    // A frontier quest's own group is only half the picture; the other members are found by asking
    // who else shares it, same as the other reverse references below.
    const groups: number[] = [];
    for (const facts of frontierFacts.values()) {
      if (facts.exclusiveGroup !== 0 && !seenGroups.has(facts.exclusiveGroup)) {
        seenGroups.add(facts.exclusiveGroup);
        groups.push(facts.exclusiveGroup);
      }
    }

    const [prevOf, nextOf, crumbsOf, rewardOf, groupRows, context] = await Promise.all([
      rowsOrNone(db, ADDON, { PrevQuestID: [...ids, ...negated] }),
      rowsOrNone(db, ADDON, { NextQuestID: ids }),
      rowsOrNone(db, ADDON, { BreadcrumbForQuestId: ids }),
      rowsOrNone(db, TEMPLATE, { RewardNextQuest: ids }),
      groups.length > 0 ? rowsOrNone(db, ADDON, { ExclusiveGroup: groups.map(String) }) : Promise.resolve([]),
      readLinkContext(db, frontier, itemStarters),
    ]);

    const referencing = new Set<number>();
    for (const row of prevOf) referencing.add(idOf(row.ID));
    for (const row of nextOf) referencing.add(idOf(row.ID));
    for (const row of crumbsOf) referencing.add(idOf(row.ID));
    for (const row of rewardOf) referencing.add(idOf(row.ID));
    for (const row of groupRows) referencing.add(idOf(row.ID));

    // A quest that only turns into another through a script (turn-in fires a SmartAI offer) never
    // shows up in the reverse column queries above; the offered quest's own facts are what recognition
    // needs to see the edge, so they are fetched here just like any other referencing quest.
    const offered = new Set<number>();
    for (const row of context.questRows) {
      if (row.actionType === ACTION.offerQuest) offered.add(row.actionParams[0]);
    }

    const extraIds = [...new Set([...referencing, ...offered])].filter((id) => id > 0 && id !== 0);
    const extraFacts = await readWorldFacts(db, extraIds);
    const facts = new Map<number, QuestFacts>([...frontierFacts, ...extraFacts]);

    const { instances } = recogniseLinks({ facts, context }, CATALOG, available);

    const candidates = new Set<number>();
    for (const instance of instances) {
      for (const edge of questEdges(instance)) {
        link(edge.from, edge.to);
        candidates.add(edge.from);
        candidates.add(edge.to);
      }
      if (instance.from.kind === 'quest') candidates.add(instance.from.questId);
      if (instance.to.kind === 'quest') candidates.add(instance.to.questId);
      const members = instance.params.members;
      if (Array.isArray(members)) {
        for (const member of members) if (typeof member === 'number') candidates.add(member);
      }
    }

    // A candidate can name a quest that was never created; only quests that exist join the chain.
    const fresh = [...candidates].filter((id) => id > 0 && !seen.has(id));
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

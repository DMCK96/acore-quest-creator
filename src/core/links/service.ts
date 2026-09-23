import type { WorldDb } from '../db/world-db';
import type { QuestAggregate } from '../model/aggregate';
import { factsFromAggregate, readWorldFacts, type QuestFacts } from './facts';
import { readLinkContext, rowsOrNone, type ItemStarter } from './context';
import { recogniseLinks, type RecognitionResult } from './recognise';
import { CATALOG } from './catalog';
import { ACTION } from '../smartai/ids';
import type { ComponentId, ComponentInstance } from './model';

/**
 * The one entry point the API calls to answer "what links touch this quest": it merges draft facts
 * over world facts, pulls in whatever neighbour quests those facts or scripts point at so a check can
 * see both ends of a link, recognises components once across the whole set, then narrows the result
 * back down to what the caller's scope actually touches. Callers never build `RecogniseInput` by hand.
 *
 * Neighbours are found in both directions. A chain is usually written on its later quest only (B says
 * `PrevQuestID = A`, A says nothing about B), so a scope quest's own facts cannot name everything
 * that links to it; the quests that point back are found by a batched reverse read, plus a scan of
 * the drafts for links the user has added but not exported.
 */

export interface LinkSnapshot {
  facts: ReadonlyMap<number, QuestFacts>;
  /** Filtered to instances (and unrecognised rows) touching the scope. */
  result: RecognitionResult;
}

/** True when an instance is anchored to `questId`, whether directly, as owner, or as a group member. */
export function touches(instance: ComponentInstance, questId: number): boolean {
  const endpointMatches = (endpoint: ComponentInstance['from']): boolean =>
    endpoint.kind === 'quest' && endpoint.questId === questId;
  if (endpointMatches(instance.from) || endpointMatches(instance.to)) return true;
  if (instance.owner === questId) return true;
  const members = instance.params.members;
  return Array.isArray(members) && members.includes(questId);
}

async function factsFor(
  db: WorldDb,
  ids: readonly number[],
  drafts: ReadonlyMap<number, QuestAggregate>,
  facts: Map<number, QuestFacts>,
): Promise<void> {
  const missing = ids.filter((id) => !facts.has(id));
  const fromWorld: number[] = [];
  for (const id of missing) {
    const draft = drafts.get(id);
    if (draft) facts.set(id, factsFromAggregate(draft));
    else fromWorld.push(id);
  }
  if (fromWorld.length === 0) return;
  const worldFacts = await readWorldFacts(db, fromWorld);
  for (const [id, questFacts] of worldFacts) facts.set(id, questFacts);
}

const pointsAt = (facts: QuestFacts, ids: ReadonlySet<number>): boolean =>
  ids.has(Math.abs(facts.prevQuestId))
  || ids.has(facts.nextQuestId)
  || ids.has(facts.rewardNextQuest)
  || ids.has(facts.breadcrumbFor);

const idOf = (raw: string | null | undefined): number => {
  const n = Number(raw ?? '');
  return Number.isInteger(n) ? n : 0;
};

/** Quests whose own chain columns name a scope quest, from the world rows and from the drafts. */
async function questsPointingAt(
  db: WorldDb,
  scope: readonly number[],
  drafts: ReadonlyMap<number, QuestAggregate>,
): Promise<number[]> {
  if (scope.length === 0) return [];
  const ids = scope.map(String);
  const negated = scope.map((id) => String(-id));
  const rowSets = await Promise.all([
    rowsOrNone(db, 'quest_template_addon', { PrevQuestID: [...ids, ...negated] }),
    rowsOrNone(db, 'quest_template_addon', { NextQuestID: ids }),
    rowsOrNone(db, 'quest_template_addon', { BreadcrumbForQuestId: ids }),
    rowsOrNone(db, 'quest_template', { RewardNextQuest: ids }),
  ]);
  const found = new Set<number>();
  for (const rows of rowSets) for (const row of rows) found.add(idOf(row.ID));
  const scopeSet = new Set(scope);
  for (const [questId, aggregate] of drafts) {
    if (pointsAt(factsFromAggregate(aggregate), scopeSet)) found.add(questId);
  }
  return [...found].filter((id) => id > 0);
}

export async function loadLinks(
  db: WorldDb,
  scope: readonly number[],
  drafts: ReadonlyMap<number, QuestAggregate>,
  available?: ReadonlySet<ComponentId>,
  /** The session's item starters (see `readItemStarters`); omitted, `item_template` is read here. */
  itemStarters?: readonly ItemStarter[],
): Promise<LinkSnapshot> {
  const facts = new Map<number, QuestFacts>();
  await factsFor(db, scope, drafts, facts);

  const context = await readLinkContext(db, scope, itemStarters);

  const neighbourIds = new Set<number>();
  for (const scopeId of scope) {
    const questFacts = facts.get(scopeId);
    if (!questFacts) continue;
    if (Math.abs(questFacts.prevQuestId) > 0) neighbourIds.add(Math.abs(questFacts.prevQuestId));
    if (questFacts.nextQuestId > 0) neighbourIds.add(questFacts.nextQuestId);
    if (questFacts.rewardNextQuest > 0) neighbourIds.add(questFacts.rewardNextQuest);
    if (questFacts.breadcrumbFor > 0) neighbourIds.add(questFacts.breadcrumbFor);
  }
  for (const row of context.questRows) {
    if (row.actionType === ACTION.offerQuest && row.actionParams[0] > 0) neighbourIds.add(row.actionParams[0]);
  }
  // A draft's facts win over its world row, so a world link the user has since cleared finds the
  // quest here but recognises nothing once the draft's facts are read.
  for (const id of await questsPointingAt(db, scope, drafts)) neighbourIds.add(id);
  for (const scopeId of scope) neighbourIds.delete(scopeId);

  await factsFor(db, [...neighbourIds], drafts, facts);

  const result = recogniseLinks({ facts, context }, CATALOG, available);
  const scopeSet = new Set(scope);
  const scopeIds = [...scopeSet];
  const filtered: RecognitionResult = {
    instances: result.instances.filter((instance) => scopeIds.some((id) => touches(instance, id))),
    unrecognised: result.unrecognised.filter((row) => scopeSet.has(row.questId)),
  };

  return { facts, result: filtered };
}

import type { WorldDb } from '../db/world-db';
import type { QuestAggregate } from '../model/aggregate';
import { factsFromAggregate, readWorldFacts, type QuestFacts } from './facts';
import { readLinkContext } from './context';
import { recogniseLinks, type RecognitionResult } from './recognise';
import { CATALOG } from './catalog';
import { ACTION } from '../smartai/ids';
import type { ComponentId, ComponentInstance } from './model';

/**
 * The one entry point the API calls to answer "what links touch this quest": it merges draft facts
 * over world facts, pulls in whatever neighbour quests those facts or scripts point at so a check can
 * see both ends of a link, recognises components once across the whole set, then narrows the result
 * back down to what the caller's scope actually touches. Callers never build `RecogniseInput` by hand.
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

export async function loadLinks(
  db: WorldDb,
  scope: readonly number[],
  drafts: ReadonlyMap<number, QuestAggregate>,
  available?: ReadonlySet<ComponentId>,
): Promise<LinkSnapshot> {
  const facts = new Map<number, QuestFacts>();
  await factsFor(db, scope, drafts, facts);

  const context = await readLinkContext(db, scope);

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

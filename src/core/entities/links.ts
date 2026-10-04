import { readScenes, type SceneOwner } from '../scripts/model';
import type { ProjectEntities } from './model';

/**
 * Which quests use which of the project's NPCs, objects and items. Nothing is stored: a quest uses
 * what it names (givers, enders, objectives, its scenes, a fight crediting it, its items) and what was
 * made for it, so the links can never drift from the quest.
 */

type WithValues = { values: Readonly<Record<string, unknown>> };
type QuestLike = { questId: number; aggregate: WithValues };

const rowsOf = (values: Readonly<Record<string, unknown>>, fieldId: string): Array<Record<string, unknown>> => {
  const rows = values[fieldId];
  return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
};

/** The four NPC-or-object objectives as signed entries: creatures positive, objects negative, none 0. */
export function objectivesOf(aggregate: WithValues): number[] {
  const list = rowsOf(aggregate.values, 'quest_template.RequiredNpcOrGo');
  return [0, 1, 2, 3].map((i) => {
    const target = list[i]?.target as { target?: string; id?: number } | undefined;
    if (!target || typeof target.id !== 'number') return 0;
    return target.target === 'gameobject' ? -target.id : target.id;
  });
}

/** The quest's starters or enders as scene owners. */
export function relationOwners(aggregate: WithValues, kind: 'starter' | 'ender'): SceneOwner[] {
  const owners: SceneOwner[] = [];
  for (const [fieldId, ownerKind] of [
    [`creature_quest${kind}`, 'creature'],
    [`gameobject_quest${kind}`, 'gameobject'],
  ] as const) {
    for (const row of rowsOf(aggregate.values, fieldId)) {
      if (typeof row.id === 'number' && row.id > 0) owners.push({ kind: ownerKind, entry: row.id });
    }
  }
  return owners;
}

/** The items the quest asks for: their drops are set in Objectives, never by a loot list. */
export function questItemsOf(aggregate: WithValues): number[] {
  return rowsOf(aggregate.values, 'quest_template.RequiredItems').flatMap((r) => (typeof r.item === 'number' && r.item > 0 ? [r.item] : []));
}

export interface QuestUse {
  npcs: number[];
  objects: number[];
  items: number[];
}

export function questUses(quest: QuestLike, entities: ProjectEntities): QuestUse {
  const { values } = quest.aggregate;
  const npcs = new Set<number>();
  const objects = new Set<number>();
  const items = new Set<number>();
  const owner = (o: SceneOwner): void => {
    if (o.kind === 'creature') npcs.add(o.entry);
    else if (o.kind === 'gameobject') objects.add(o.entry);
  };
  [...relationOwners(quest.aggregate, 'starter'), ...relationOwners(quest.aggregate, 'ender')].forEach(owner);
  for (const entry of objectivesOf(quest.aggregate)) {
    if (entry > 0) npcs.add(entry);
    else if (entry < 0) objects.add(-entry);
  }
  for (const scene of readScenes(values)) {
    owner(scene.owner);
    for (const step of scene.steps) {
      if (step.kind === 'spawnNpc' || step.kind === 'despawn') npcs.add(step.entry);
      else if (step.kind === 'spawnObject' || step.kind === 'objectState') objects.add(step.entry);
      else if (step.kind === 'signal') (step.targetKind === 'creature' ? npcs : objects).add(step.entry);
      else if (step.kind === 'giveItem' || step.kind === 'takeItem') items.add(step.item);
    }
  }
  for (const fieldId of ['quest_template.RequiredItems', 'quest_template.RewardItems', 'quest_template.RewardChoiceItems', 'quest_template.ItemDrops']) {
    for (const row of rowsOf(values, fieldId)) if (typeof row.item === 'number' && row.item > 0) items.add(row.item);
  }
  const start = values['quest_template.StartItem'];
  if (typeof start === 'number' && start > 0) items.add(start);
  for (const npc of entities.npcs) {
    if (npc.madeFor === quest.questId) npcs.add(npc.entry);
    const credits = npc.fight?.reactions.some((r) => r.steps.some((s) => s.kind === 'credit' && s.quest === quest.questId));
    if (credits) npcs.add(npc.entry);
  }
  for (const object of entities.objects) if (object.madeFor === quest.questId) objects.add(object.entry);
  for (const item of entities.items) if (item.madeFor === quest.questId) items.add(item.entry);
  const kept = (set: Set<number>, have: readonly { entry: number }[]): number[] =>
    have.map((e) => e.entry).filter((e) => set.has(e)).filter((e, i, all) => all.indexOf(e) === i).sort((a, b) => a - b);
  return { npcs: kept(npcs, entities.npcs), objects: kept(objects, entities.objects), items: kept(items, entities.items) };
}

/** The quests that use an entity, by id */
export function usedBy(kind: 'npc' | 'object' | 'item', entry: number, quests: readonly QuestLike[], entities: ProjectEntities): number[] {
  const key = kind === 'npc' ? 'npcs' : kind === 'object' ? 'objects' : 'items';
  return quests.filter((q) => questUses(q, entities)[key].includes(entry)).map((q) => q.questId).sort((a, b) => a - b);
}

/** The part of the store a quest uses */
export function narrowTo(entities: ProjectEntities, use: QuestUse): ProjectEntities {
  return {
    npcs: entities.npcs.filter((n) => use.npcs.includes(n.entry)),
    objects: entities.objects.filter((o) => use.objects.includes(o.entry)),
    items: entities.items.filter((i) => use.items.includes(i.entry)),
  };
}

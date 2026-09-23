import type { RawRow, Where } from '../db/types';
import { UnknownColumnError, UnknownTableError, type WorldDb } from '../db/world-db';
import type { QuestAggregate } from '../model/aggregate';
import type { RowSetValue } from '../registry/types';

/**
 * The chain columns, givers and condition count a quest link component reader is built from — read
 * either from an already-imported `QuestAggregate` or straight from the world DB for quests that are
 * not open in the editor (a chain-walk neighbour, say).
 *
 * The two readers must agree: `factsFromAggregate` decodes the same fields the registry already
 * pulled in, `readWorldFacts` reads the underlying tables itself, and both apply the same sort order
 * so a component built from either source claims the same rows in the same order.
 */

export interface EventStarter {
  eventEntry: number;
  kind: 'creature' | 'gameobject';
  id: number;
}

export interface QuestFacts {
  questId: number;
  isNew: boolean;
  prevQuestId: number;
  nextQuestId: number;
  rewardNextQuest: number;
  breadcrumbFor: number;
  exclusiveGroup: number;
  creatureStarters: number[];
  objectStarters: number[];
  creatureEnders: number[];
  objectEnders: number[];
  eventStarters: EventStarter[];
  availabilityConditions: number;
}

const numberOf = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

const ascending = (a: number, b: number): number => a - b;

const idsOf = (value: unknown): number[] => {
  if (!Array.isArray(value)) return [];
  return (value as RowSetValue)
    .map((row) => numberOf(row.id))
    .sort(ascending);
};

const eventStartersOf = (kind: EventStarter['kind'], value: unknown): EventStarter[] => {
  if (!Array.isArray(value)) return [];
  return (value as RowSetValue).map((row) => ({ eventEntry: numberOf(row.eventEntry), id: numberOf(row.id), kind }));
};

const KIND_ORDER: Record<EventStarter['kind'], number> = { creature: 0, gameobject: 1 };

const sortEventStarters = (starters: EventStarter[]): EventStarter[] =>
  starters.slice().sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.eventEntry - b.eventEntry || a.id - b.id);

export function factsFromAggregate(aggregate: QuestAggregate): QuestFacts {
  const values = aggregate.values;
  return {
    questId: aggregate.questId,
    isNew: aggregate.isNew,
    prevQuestId: numberOf(values['quest_template_addon.PrevQuestID']),
    nextQuestId: numberOf(values['quest_template_addon.NextQuestID']),
    rewardNextQuest: numberOf(values['quest_template.RewardNextQuest']),
    breadcrumbFor: numberOf(values['quest_template_addon.BreadcrumbForQuestId']),
    exclusiveGroup: numberOf(values['quest_template_addon.ExclusiveGroup']),
    creatureStarters: idsOf(values.creature_queststarter),
    objectStarters: idsOf(values.gameobject_queststarter),
    creatureEnders: idsOf(values.creature_questender),
    objectEnders: idsOf(values.gameobject_questender),
    eventStarters: sortEventStarters([
      ...eventStartersOf('creature', values.game_event_creature_quest),
      ...eventStartersOf('gameobject', values.game_event_gameobject_quest),
    ]),
    availabilityConditions: Array.isArray(values.conditions) ? (values.conditions as RowSetValue).length : 0,
  };
}

/** A fork without the table or column simply has no rows of that kind. */
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

const intOf = (raw: string | null | undefined): number => {
  if (raw === null || raw === undefined || !/^-?\d+$/.test(raw)) return 0;
  return Number(raw);
};

export async function readWorldFacts(db: WorldDb, questIds: readonly number[]): Promise<Map<number, QuestFacts>> {
  const result = new Map<number, QuestFacts>();
  if (questIds.length === 0) return result;
  const ids = questIds.map(String);

  const existing = await rowsOrNone(db, 'quest_template', { ID: ids });
  const wanted = new Set(existing.map((row) => intOf(row.ID)));
  if (wanted.size === 0) return result;
  const wantedIds = [...wanted].map(String);

  const [addonRows, creatureStarterRows, objectStarterRows, creatureEnderRows, objectEnderRows,
    creatureEventRows, objectEventRows, conditionRows] = await Promise.all([
    rowsOrNone(db, 'quest_template_addon', { ID: wantedIds }),
    rowsOrNone(db, 'creature_queststarter', { quest: wantedIds }),
    rowsOrNone(db, 'gameobject_queststarter', { quest: wantedIds }),
    rowsOrNone(db, 'creature_questender', { quest: wantedIds }),
    rowsOrNone(db, 'gameobject_questender', { quest: wantedIds }),
    rowsOrNone(db, 'game_event_creature_quest', { quest: wantedIds }),
    rowsOrNone(db, 'game_event_gameobject_quest', { quest: wantedIds }),
    rowsOrNone(db, 'conditions', { SourceTypeOrReferenceId: '19', SourceEntry: wantedIds }),
  ]);

  const addonById = new Map(addonRows.map((row) => [intOf(row.ID), row]));
  const groupBy = <T>(rows: RawRow[], key: string, map: (row: RawRow) => T): Map<number, T[]> => {
    const out = new Map<number, T[]>();
    for (const row of rows) {
      const questId = intOf(row[key]);
      const list = out.get(questId);
      const item = map(row);
      if (list) list.push(item);
      else out.set(questId, [item]);
    }
    return out;
  };

  const creatureStartersByQuest = groupBy(creatureStarterRows, 'quest', (row) => intOf(row.id));
  const objectStartersByQuest = groupBy(objectStarterRows, 'quest', (row) => intOf(row.id));
  const creatureEndersByQuest = groupBy(creatureEnderRows, 'quest', (row) => intOf(row.id));
  const objectEndersByQuest = groupBy(objectEnderRows, 'quest', (row) => intOf(row.id));
  const creatureEventsByQuest = groupBy(creatureEventRows, 'quest', (row) => ({
    eventEntry: intOf(row.eventEntry), id: intOf(row.id), kind: 'creature' as const,
  }));
  const objectEventsByQuest = groupBy(objectEventRows, 'quest', (row) => ({
    eventEntry: intOf(row.eventEntry), id: intOf(row.id), kind: 'gameobject' as const,
  }));
  const conditionsByQuest = groupBy(conditionRows, 'SourceEntry', () => true);

  for (const questId of wanted) {
    const addon = addonById.get(questId);
    const templateRow = existing.find((row) => intOf(row.ID) === questId);
    result.set(questId, {
      questId,
      isNew: false,
      prevQuestId: addon ? intOf(addon.PrevQuestID) : 0,
      nextQuestId: addon ? intOf(addon.NextQuestID) : 0,
      rewardNextQuest: templateRow ? intOf(templateRow.RewardNextQuest) : 0,
      breadcrumbFor: addon ? intOf(addon.BreadcrumbForQuestId) : 0,
      exclusiveGroup: addon ? intOf(addon.ExclusiveGroup) : 0,
      creatureStarters: (creatureStartersByQuest.get(questId) ?? []).slice().sort(ascending),
      objectStarters: (objectStartersByQuest.get(questId) ?? []).slice().sort(ascending),
      creatureEnders: (creatureEndersByQuest.get(questId) ?? []).slice().sort(ascending),
      objectEnders: (objectEndersByQuest.get(questId) ?? []).slice().sort(ascending),
      eventStarters: sortEventStarters([
        ...(creatureEventsByQuest.get(questId) ?? []),
        ...(objectEventsByQuest.get(questId) ?? []),
      ]),
      availabilityConditions: (conditionsByQuest.get(questId) ?? []).length,
    });
  }
  return result;
}

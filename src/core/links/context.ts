import type { RawRow, Where } from '../db/types';
import { UnknownColumnError, UnknownTableError, type WorldDb } from '../db/world-db';
import { ACTION, EVENT, SOURCE, CONDITION_SOURCE_SMART_EVENT } from '../smartai/ids';
import { EMPTY_CONTEXT, scriptRowKey, type LinkContext, type ScriptRow } from './model';

/**
 * `readLinkContext` is the one place a component reader touches the world DB for SmartAI-backed
 * components: every select it issues is batched across the whole quest set (or the whole script-pair
 * set it discovers along the way), never one query per quest, so building a chain-walk view of many
 * quests stays a handful of round trips instead of hundreds.
 */

export const CONTEXT_TABLES = ['smart_scripts', 'conditions', 'item_template', 'areatrigger_scripts'] as const;

interface ScriptPair {
  sourceType: number;
  entryorguid: number;
}

const pairKey = (p: ScriptPair): string => `${p.sourceType}/${p.entryorguid}`;

const numberOf = (raw: string | null | undefined): number => {
  if (raw === null || raw === undefined) return 0;
  const n = Number(raw);
  return Number.isInteger(n) ? n : 0;
};

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

function toScriptRow(row: RawRow): ScriptRow {
  return {
    entryorguid: numberOf(row.entryorguid),
    sourceType: numberOf(row.source_type),
    id: numberOf(row.id),
    link: numberOf(row.link),
    eventType: numberOf(row.event_type),
    eventParams: [1, 2, 3, 4, 5, 6].map((n) => numberOf(row[`event_param${n}`])),
    actionType: numberOf(row.action_type),
    actionParams: [1, 2, 3, 4, 5, 6].map((n) => numberOf(row[`action_param${n}`])),
    targetType: numberOf(row.target_type),
    comment: row.comment ?? '',
  };
}

const compareRows = (a: ScriptRow, b: ScriptRow): number =>
  a.sourceType - b.sourceType || a.entryorguid - b.entryorguid || a.id - b.id || a.link - b.link;

/**
 * The quest a script row names, by the same rule as B1's SmartAI components: an offer/fail/explore/
 * group action, a quest-accepted/turned-in event, an escort's start or stop quest param, or a quest
 * script's own `entryorguid` (source type 5, where the row's owning quest *is* its identity).
 */
export function questNamedBy(row: ScriptRow, questIds: ReadonlySet<number>): number | undefined {
  const has = (id: number): boolean => questIds.has(id);
  if (
    (row.actionType === ACTION.failQuest
      || row.actionType === ACTION.offerQuest
      || row.actionType === ACTION.areaExploredOrEventHappens
      || row.actionType === ACTION.groupEventHappens)
    && has(row.actionParams[0])
  ) {
    return row.actionParams[0];
  }
  if ((row.eventType === EVENT.acceptedQuest || row.eventType === EVENT.rewardQuest) && has(row.eventParams[0])) {
    return row.eventParams[0];
  }
  if (row.actionType === ACTION.escortStart && has(row.actionParams[3])) return row.actionParams[3];
  if (row.actionType === ACTION.escortStop && has(row.actionParams[1])) return row.actionParams[1];
  if (row.sourceType === SOURCE.quest && has(row.entryorguid)) return row.entryorguid;
  return undefined;
}

async function scriptsForPairs(db: WorldDb, pairs: readonly ScriptPair[]): Promise<ScriptRow[]> {
  if (pairs.length === 0) return [];
  const entryorguids = [...new Set(pairs.map((p) => String(p.entryorguid)))];
  const sourceTypes = [...new Set(pairs.map((p) => String(p.sourceType)))];
  const rows = await rowsOrNone(db, 'smart_scripts', { entryorguid: entryorguids, source_type: sourceTypes });
  const wanted = new Set(pairs.map(pairKey));
  return rows.map(toScriptRow).filter((r) => wanted.has(pairKey(r)));
}

export async function readLinkContext(db: WorldDb, questIds: readonly number[]): Promise<LinkContext> {
  if (questIds.length === 0) return EMPTY_CONTEXT;

  const idSet = new Set(questIds);
  const ids = questIds.map(String);

  const [byAction, byEvent, bySourceQuest, byEscortStart, byEscortStop] = await Promise.all([
    rowsOrNone(db, 'smart_scripts', { action_type: ['6', '7', '15', '26'], action_param1: ids }),
    rowsOrNone(db, 'smart_scripts', { event_type: ['19', '20'], event_param1: ids }),
    rowsOrNone(db, 'smart_scripts', { source_type: '5', entryorguid: ids }),
    rowsOrNone(db, 'smart_scripts', { action_type: '53', action_param4: ids }),
    rowsOrNone(db, 'smart_scripts', { action_type: '55', action_param2: ids }),
  ]);

  const candidates = [...byAction, ...byEvent, ...bySourceQuest, ...byEscortStart, ...byEscortStop].map(toScriptRow);
  const seen = new Set<string>();
  const questRows: ScriptRow[] = [];
  for (const row of candidates) {
    const key = scriptRowKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    if (questNamedBy(row, idSet) !== undefined) questRows.push(row);
  }
  questRows.sort(compareRows);

  const pairsByKey = new Map<string, ScriptPair>();
  for (const row of questRows) {
    const pair: ScriptPair = { sourceType: row.sourceType, entryorguid: row.entryorguid };
    pairsByKey.set(pairKey(pair), pair);
  }

  let scripts = await scriptsForPairs(db, [...pairsByKey.values()]);

  const timedListEntries = [...pairsByKey.values()]
    .filter((p) => p.sourceType === SOURCE.timedList)
    .map((p) => String(p.entryorguid));
  if (timedListEntries.length > 0) {
    const callerRows = (await rowsOrNone(db, 'smart_scripts', { action_type: '80', action_param1: timedListEntries })).map(toScriptRow);
    const callerPairs = new Map<string, ScriptPair>();
    for (const row of callerRows) {
      const pair: ScriptPair = { sourceType: row.sourceType, entryorguid: row.entryorguid };
      const key = pairKey(pair);
      if (!pairsByKey.has(key)) {
        pairsByKey.set(key, pair);
        callerPairs.set(key, pair);
      }
    }
    if (callerPairs.size > 0) {
      const callerScripts = await scriptsForPairs(db, [...callerPairs.values()]);
      scripts = [...scripts, ...callerScripts];
    }
  }
  scripts.sort(compareRows);

  const conditionEntries = [...new Set([...pairsByKey.values()].map((p) => String(p.entryorguid)))];
  const conditionRows = await rowsOrNone(db, 'conditions', {
    SourceTypeOrReferenceId: String(CONDITION_SOURCE_SMART_EVENT),
    SourceEntry: conditionEntries,
  });
  const sourceTypesByEntry = new Map<number, Set<number>>();
  for (const pair of pairsByKey.values()) {
    const set = sourceTypesByEntry.get(pair.entryorguid) ?? new Set<number>();
    set.add(pair.sourceType);
    sourceTypesByEntry.set(pair.entryorguid, set);
  }
  const eventConditions = conditionRows.filter((row) => {
    const set = sourceTypesByEntry.get(numberOf(row.SourceEntry));
    return set !== undefined && set.has(numberOf(row.SourceId));
  });

  const itemRows = await rowsOrNone(db, 'item_template', { startquest: ids });
  const itemStarters = itemRows
    .map((row) => ({ entry: numberOf(row.entry), questId: numberOf(row.startquest) }))
    .sort((a, b) => a.entry - b.entry);

  const areatriggerEntries = [...pairsByKey.values()]
    .filter((p) => p.sourceType === SOURCE.areatrigger)
    .map((p) => String(p.entryorguid));
  const areatriggerRows = await rowsOrNone(db, 'areatrigger_scripts', { entry: areatriggerEntries });
  const areatriggerScripts = areatriggerRows
    .map((row) => ({ entry: numberOf(row.entry), scriptName: row.ScriptName ?? '' }))
    .sort((a, b) => a.entry - b.entry);

  const creatureEntries = [...pairsByKey.values()]
    .filter((p) => p.sourceType === SOURCE.creature && p.entryorguid > 0)
    .map((p) => String(p.entryorguid));
  const gameobjectEntries = [...pairsByKey.values()]
    .filter((p) => p.sourceType === SOURCE.gameobject && p.entryorguid > 0)
    .map((p) => String(p.entryorguid));
  const [creatureRows, gameobjectRows] = await Promise.all([
    rowsOrNone(db, 'creature_template', { entry: creatureEntries }),
    rowsOrNone(db, 'gameobject_template', { entry: gameobjectEntries }),
  ]);
  const aiNames: LinkContext['aiNames'] = [
    ...creatureRows.map((row) => ({ sourceType: 0 as const, entry: numberOf(row.entry), aiName: row.AIName ?? '' })),
    ...gameobjectRows.map((row) => ({ sourceType: 1 as const, entry: numberOf(row.entry), aiName: row.AIName ?? '' })),
  ].sort((a, b) => a.sourceType - b.sourceType || a.entry - b.entry);

  return { questRows, scripts, eventConditions, itemStarters, areatriggerScripts, aiNames };
}

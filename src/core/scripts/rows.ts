import type { RawRow } from '../db/types';
import { ACTION, EVENT, SOURCE, TARGET } from '../smartai/ids';
import type { Position } from './model';

/**
 * SmartAI row building shared by the compilers that write `smart_scripts` (quest scenes and
 * fights): one row from an event and an action, id / list / text-group allocation around the rows
 * already in use, and the three shapes a trigger with its actions takes.
 */

export type Row = Record<string, string>;

/** One SmartAI action before it has a row: what it does, at whom, and how long to wait first. */
export interface SmartAction {
  type: number;
  params: number[];
  target: number;
  targetParams: number[];
  at?: Position;
  waitMs: number;
  describe: string;
  /** Percent chance the action runs when its turn comes; 100 when unset. */
  chance?: number;
}

const LIST_SLOTS = 100;
/**
 * `SMART_ACTION_CALL_TIMED_ACTIONLIST` takes `[id, timerType, allowOverride]`; timer type 2 runs the
 * list whether or not the owner is fighting. `allowOverride` is a boolean the server checks at load:
 * any other value and it skips the row.
 */
const LIST_TIMER_ALWAYS = 2;
/** Timer type 0: the list only counts down while the owner is not fighting, so a fight pauses it. */
const LIST_TIMER_OUT_OF_COMBAT = 0;
/** `creature_text.comment` is a varchar(255); a longer comment fails the whole patch in strict mode. */
const TEXT_COMMENT_MAX = 255;

/** A `creature_text` comment cut to what the column holds; the full line is in `Text`. */
export function textComment(tag: string, describe: string): string {
  const comment = `${tag}: ${describe}`;
  return comment.length <= TEXT_COMMENT_MAX ? comment : `${comment.slice(0, TEXT_COMMENT_MAX - 1)}…`;
}

const text = (n: number): string => String(n);
const num = (raw: string | null | undefined): number => {
  if (raw === null || raw === undefined) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
};

export function smartRow(input: {
  entryorguid: number;
  source: number;
  id: number;
  link: number;
  eventType: number;
  eventParams: readonly number[];
  action: SmartAction;
  comment: string;
  phaseMask?: number;
  eventFlags?: number;
}): Row {
  const { action, eventParams } = input;
  const p = (list: readonly number[], i: number): string => text(list[i] ?? 0);
  return {
    entryorguid: text(input.entryorguid), source_type: text(input.source), id: text(input.id), link: text(input.link),
    event_type: text(input.eventType), event_phase_mask: text(input.phaseMask ?? 0), event_chance: text(action.chance ?? 100), event_flags: text(input.eventFlags ?? 0),
    event_param1: p(eventParams, 0), event_param2: p(eventParams, 1), event_param3: p(eventParams, 2),
    event_param4: p(eventParams, 3), event_param5: p(eventParams, 4), event_param6: p(eventParams, 5),
    action_type: text(action.type),
    action_param1: p(action.params, 0), action_param2: p(action.params, 1), action_param3: p(action.params, 2),
    action_param4: p(action.params, 3), action_param5: p(action.params, 4), action_param6: p(action.params, 5),
    target_type: text(action.target),
    target_param1: p(action.targetParams, 0), target_param2: p(action.targetParams, 1),
    target_param3: p(action.targetParams, 2), target_param4: p(action.targetParams, 3),
    target_x: text(action.at?.x ?? 0), target_y: text(action.at?.y ?? 0), target_z: text(action.at?.z ?? 0), target_o: text(action.at?.o ?? 0),
    comment: input.comment,
  };
}

export interface SmartAllocator {
  /** The lowest free `id` on an owner. */
  takeId(entryorguid: number, source: number): number;
  /** A free timed action list id in the owner's `entry × 100 + n` range, or null when all are taken. */
  takeList(entry: number): number | null;
  /** The lowest free `creature_text` group of a creature. */
  takeGroup(creature: number): number;
}

/** Hands out numbers around `smartScripts` and `creatureText`, the rows that must not be overwritten. */
export function createAllocator(input: { smartScripts: readonly RawRow[]; creatureText: readonly RawRow[] }): SmartAllocator {
  const usedIds = new Map<string, Set<number>>();
  const usedLists = new Set<number>();
  for (const row of input.smartScripts) {
    const source = num(row.source_type);
    if (source === SOURCE.timedList) usedLists.add(num(row.entryorguid));
    const key = `${num(row.entryorguid)}/${source}`;
    const ids = usedIds.get(key) ?? new Set<number>();
    ids.add(num(row.id));
    usedIds.set(key, ids);
  }
  const usedGroups = new Map<number, Set<number>>();
  for (const row of input.creatureText) {
    const groups = usedGroups.get(num(row.CreatureID)) ?? new Set<number>();
    groups.add(num(row.GroupID));
    usedGroups.set(num(row.CreatureID), groups);
  }
  const lowestFree = (used: Set<number>): number => {
    let n = 0;
    while (used.has(n)) n += 1;
    used.add(n);
    return n;
  };
  return {
    takeId(entryorguid, source) {
      const key = `${entryorguid}/${source}`;
      const ids = usedIds.get(key) ?? new Set<number>();
      usedIds.set(key, ids);
      return lowestFree(ids);
    },
    takeList(entry) {
      for (let slot = 0; slot < LIST_SLOTS; slot += 1) {
        const id = entry * LIST_SLOTS + slot;
        if (!usedLists.has(id)) {
          usedLists.add(id);
          return id;
        }
      }
      return null;
    },
    takeGroup(creature) {
      const groups = usedGroups.get(creature) ?? new Set<number>();
      usedGroups.set(creature, groups);
      return lowestFree(groups);
    },
  };
}

/**
 * A trigger and its actions as rows. One immediate action goes on the trigger row itself. Otherwise
 * `link` chains the actions with `SMART_EVENT_LINK` rows (waits ignored: for owners that cannot run
 * timed lists, or are dead), and `list` has the trigger call a timed action list whose rows carry
 * the waits. Null when a list is needed and the owner has none free.
 */
export function emitTrigger(input: {
  alloc: SmartAllocator;
  entryorguid: number;
  source: number;
  eventType: number;
  eventParams: readonly number[];
  actions: readonly SmartAction[];
  header: string;
  tag: string;
  shape: 'list' | 'link';
  phaseMask?: number;
  eventFlags?: number;
  /** Whether this list replaces one the owner is still running, rather than being dropped. */
  listOverride?: boolean;
  /** True for a list that waits out a fight instead of running through it. */
  listOutOfCombat?: boolean;
  /** False when the event cannot carry this action on its own row, so even one action goes in a list. */
  allowSingle?: boolean;
}): { rows: Row[]; triggerId: number } | null {
  const { alloc, entryorguid, source, eventType, eventParams, actions, header, tag, phaseMask, eventFlags } = input;
  const flags = { phaseMask, eventFlags };
  if ((input.allowSingle ?? true) && actions.length === 1 && actions[0]!.waitMs === 0) {
    const triggerId = alloc.takeId(entryorguid, source);
    return { triggerId, rows: [smartRow({ entryorguid, source, id: triggerId, link: 0, eventType, eventParams, action: actions[0]!, comment: header, ...flags })] };
  }
  if (input.shape === 'link') {
    const ids = actions.map(() => alloc.takeId(entryorguid, source));
    const rows = actions.map((action, i) => {
      const link = ids[i + 1] ?? 0;
      return i === 0
        ? smartRow({ entryorguid, source, id: ids[i]!, link, eventType, eventParams, action, comment: header, ...flags })
        : smartRow({ entryorguid, source, id: ids[i]!, link, eventType: EVENT.link, eventParams: [], action, comment: `${tag}: ${action.describe}` });
    });
    return { triggerId: ids[0]!, rows };
  }
  const list = alloc.takeList(entryorguid);
  if (list === null) return null;
  const triggerId = alloc.takeId(entryorguid, source);
  const call: SmartAction = {
    type: ACTION.callTimedList, params: [list, input.listOutOfCombat ? LIST_TIMER_OUT_OF_COMBAT : LIST_TIMER_ALWAYS, input.listOverride ? 1 : 0], target: TARGET.self, targetParams: [], waitMs: 0, describe: '',
  };
  const rows = [smartRow({ entryorguid, source, id: triggerId, link: 0, eventType, eventParams, action: call, comment: header, ...flags })];
  actions.forEach((action, i) =>
    rows.push(smartRow({
      entryorguid: list, source: SOURCE.timedList, id: i, link: 0, eventType: EVENT.updateIc,
      eventParams: [action.waitMs, action.waitMs, 0, 0], action, comment: `${tag}: ${action.describe}`,
    })),
  );
  return { triggerId, rows };
}

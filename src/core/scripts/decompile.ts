import type { RawRow } from '../db/types';

/** A row as read, where a column the query did not return reads as missing rather than failing. */
type LooseRow = Readonly<Record<string, string | null | undefined>>;
import { toScriptRow } from '../links/context';
import { ACTION, COMBAT_EVENTS, EVENT, SOURCE, describeEvent, stepName } from '../smartai/ids';
import type { OwnerKind, QuestScene } from './model';
import { isOurs, sceneFromComment, sceneIdOf } from './tag';

/** A script on one of the quest's NPCs, objects or areas that the tool did not write, in words. */
export interface ForeignScene {
  ownerKind: OwnerKind;
  entry: number;
  trigger: string;
  steps: string[];
  combat: boolean;
}

const num = (raw: string | null | undefined): number => {
  if (raw === null || raw === undefined) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
};

const isTriggerRow = (row: LooseRow): boolean =>
  num(row.source_type) <= SOURCE.areatrigger && num(row.event_type) !== EVENT.link;

const sceneNumber = (id: string): number => Number(id.slice(1));

/**
 * The scenes this quest's tagged rows carry, rebuilt from the JSON each trigger row holds. A trigger
 * row whose data cannot be read is reported by scene id instead, and its rows stay untouched on export.
 */
export function scenesFromRows(questId: number, taggedSmartRows: readonly LooseRow[]): { scenes: QuestScene[]; unreadable: string[] } {
  const scenes = new Map<string, QuestScene>();
  const unreadable = new Set<string>();
  for (const row of taggedSmartRows) {
    if (!isOurs(row.comment, questId) || !isTriggerRow(row)) continue;
    const scene = sceneFromComment(row.comment);
    if (scene) scenes.set(scene.id, scene);
    else {
      const id = sceneIdOf(row.comment, questId);
      if (id) unreadable.add(id);
    }
  }
  for (const id of scenes.keys()) unreadable.delete(id);
  return {
    scenes: [...scenes.values()].sort((a, b) => sceneNumber(a.id) - sceneNumber(b.id)),
    unreadable: [...unreadable].sort((a, b) => sceneNumber(a) - sceneNumber(b)),
  };
}

const OWNER_KIND: Record<number, OwnerKind> = {
  [SOURCE.creature]: 'creature',
  [SOURCE.gameobject]: 'gameobject',
  [SOURCE.areatrigger]: 'areatrigger',
};

/**
 * Scripts the tool did not write, one entry per trigger: the trigger row, the rows it links to and
 * the timed sequence it runs. Read-only, so the author can see everything that affects the quest.
 */
export function foreignScenes(questId: number, rows: readonly LooseRow[]): ForeignScene[] {
  const foreign = rows.filter((r) => !isOurs(r.comment, questId));
  const byOwner = new Map<string, LooseRow[]>();
  for (const row of foreign) {
    const key = `${num(row.source_type)}/${num(row.entryorguid)}`;
    byOwner.set(key, [...(byOwner.get(key) ?? []), row]);
  }
  const heads = foreign
    .filter((r) => isTriggerRow(r) && OWNER_KIND[num(r.source_type)] !== undefined)
    .sort((a, b) => num(a.source_type) - num(b.source_type) || num(a.entryorguid) - num(b.entryorguid) || num(a.id) - num(b.id));

  return heads.map((head) => {
    const sameOwner = byOwner.get(`${num(head.source_type)}/${num(head.entryorguid)}`) ?? [];
    const chain: LooseRow[] = [head];
    const seen = new Set([num(head.id)]);
    let current = head;
    while (num(current.link) !== 0) {
      const next = sameOwner.find((r) => num(r.id) === num(current.link));
      if (!next || seen.has(num(next.id))) break;
      seen.add(num(next.id));
      chain.push(next);
      current = next;
    }
    const actions: number[] = [];
    for (const row of chain) {
      const type = num(row.action_type);
      if (type === ACTION.callTimedList) {
        const list = (byOwner.get(`${SOURCE.timedList}/${num(row.action_param1)}`) ?? []).slice().sort((a, b) => num(a.id) - num(b.id));
        if (list.length > 0) {
          actions.push(...list.map((r) => num(r.action_type)));
          continue;
        }
      }
      if (type !== 0) actions.push(type);
    }
    const steps: string[] = [];
    for (const name of actions.map(stepName)) if (steps.at(-1) !== name) steps.push(name);
    return {
      ownerKind: OWNER_KIND[num(head.source_type)]!,
      entry: num(head.entryorguid),
      trigger: describeEvent(toScriptRow(head as RawRow)),
      steps,
      combat: COMBAT_EVENTS.has(num(head.event_type)),
    };
  });
}

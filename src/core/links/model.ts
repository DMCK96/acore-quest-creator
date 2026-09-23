import type { RawRow } from '../db/types';
import type { FieldValue } from '../registry/types';

/**
 * The vocabulary every quest-link component is built from: how a quest is unlocked, offered or
 * gated, what mechanism carries that behaviour, and the endpoints a component connects.
 *
 * A `ComponentInstance` is the runtime shape a later task's readers produce: one concrete thing the
 * server will do, tied back to the DB rows that would need editing to change it (`claims`), so the
 * UI can show provenance and the editor can know which rows a change touches.
 */

/** When, in a quest's lifecycle, a component takes effect. */
export type HookKind = 'availability' | 'start'
  | 'accept' | 'objectiveProgress' | 'objectiveComplete' | 'complete' | 'turnIn' | 'enterArea';

/** What a component does to the quest graph or the world. */
export type ActionKind = 'unlockQuest' | 'offerQuest' | 'gateQuest'
  | 'summonCreature' | 'spawnGameObject' | 'useGameObject';

/** The system whose rows implement a component. */
export type Mechanism = 'questColumns' | 'questRelations' | 'item' | 'conditions' | 'smartai' | 'backend';

export type ComponentId =
  | 'unlock.afterTurnIn' | 'unlock.whileInLog' | 'unlock.nextQuest' | 'start.offeredStraightAway'
  | 'gate.breadcrumb' | 'group.pickOne' | 'group.finishAll' | 'start.npc' | 'start.object'
  | 'start.gameEvent' | 'gate.condition' | 'start.item' | 'start.smartai' | 'start.backend';

/** One side of a component: the quest, world object or abstraction it connects. */
export type Endpoint =
  | { kind: 'quest'; questId: number }
  | { kind: 'creature'; entry: number }
  | { kind: 'creatureSpawn'; guid: number }
  | { kind: 'gameobject'; entry: number }
  | { kind: 'gameobjectSpawn'; guid: number }
  | { kind: 'item'; entry: number }
  | { kind: 'areatrigger'; id: number }
  | { kind: 'script'; sourceType: number; entryorguid: number }
  | { kind: 'group'; group: number }
  | { kind: 'conditions' }
  | { kind: 'backend' };

export type ParamValue = number | string | readonly number[];

/** A DB row a component instance is backed by, for provenance and edit routing. */
export interface RowRef {
  table: string;
  key: string;
  column?: string;
}

export interface ComponentInstance {
  id: string;
  component: ComponentId;
  owner: number;
  from: Endpoint;
  to: Endpoint;
  params: Record<string, ParamValue>;
  claims: RowRef[];
  editable: boolean;
  readOnlyReason?: string;
  /** Present in the DB but the server will not run it (spec §12.1). */
  inactiveReason?: string;
}

export interface LinkEdit {
  questId: number;
  fieldId: string;
  value: FieldValue;
}

/** One `smart_scripts`-shaped row: SmartAI, or a `waypoint_scripts`-style legacy table read the same way. */
export interface ScriptRow {
  entryorguid: number;
  sourceType: number;
  id: number;
  link: number;
  eventType: number;
  eventParams: number[];
  actionType: number;
  actionParams: number[];
  targetType: number;
  comment: string;
}

/**
 * Everything read once per chain walk or list build, batched so a component reader never issues a
 * query per quest.
 */
export interface LinkContext {
  questRows: ScriptRow[];
  scripts: ScriptRow[];
  eventConditions: RawRow[];
  itemStarters: { entry: number; questId: number }[];
  areatriggerScripts: { entry: number; scriptName: string }[];
  aiNames: { sourceType: 0 | 1; entry: number; aiName: string }[];
}

export const EMPTY_CONTEXT: LinkContext = {
  questRows: [],
  scripts: [],
  eventConditions: [],
  itemStarters: [],
  areatriggerScripts: [],
  aiNames: [],
};

const claimText = (claim: RowRef): string => `${claim.table}[${claim.key}]${claim.column ? `.${claim.column}` : ''}`;

/** A deterministic id from the rows a component claims, so the same DB state always names it the same. */
export function instanceId(component: ComponentId, claims: readonly RowRef[], fallback?: string): string {
  if (claims.length === 0) return `${component}:${fallback ?? ''}`;
  return `${component}:${claims.map(claimText).join('+')}`;
}

/** The primary key of a `smart_scripts`-shaped row, in column order. */
export function scriptRowKey(row: ScriptRow): string {
  return `entryorguid=${row.entryorguid},source_type=${row.sourceType},id=${row.id},link=${row.link}`;
}

export function isQuestLink(i: ComponentInstance): boolean {
  return i.from.kind === 'quest' && i.to.kind === 'quest';
}

/**
 * The quest-to-quest edges a component instance implies, for graph building. Most components are
 * either a direct quest link or carry no quest edge at all; `group.finishAll` is the one component
 * whose several members must each complete before its target unlocks.
 */
export function questEdges(i: ComponentInstance): { from: number; to: number }[] {
  if (isQuestLink(i)) {
    const from = i.from as { kind: 'quest'; questId: number };
    const to = i.to as { kind: 'quest'; questId: number };
    return [{ from: from.questId, to: to.questId }];
  }
  if (i.component === 'group.finishAll') {
    const members = i.params.members;
    const then = i.params.then;
    if (Array.isArray(members) && typeof then === 'number' && then > 0) {
      return members.map((member) => ({ from: member, to: then }));
    }
  }
  return [];
}

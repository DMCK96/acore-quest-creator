import type { RawRow } from '../db/types';
import type { CustomNpc, Patrol, PointAction } from '../entities/model';
import type { CompiledScripts } from '../scripts/compile';
import type { ScriptContext } from '../scripts/context';
import { createAllocator, emitTrigger, textComment, type Row, type SmartAction } from '../scripts/rows';
import { patrolEntryOf, patrolTag } from '../scripts/tag';
import { ACTION, EVENT, SOURCE, TARGET, TEXT_TYPE } from '../smartai/ids';

/**
 * What new NPCs do at the points of their patrols, as SmartAI rows. Runs after scenes and fights,
 * taking their rows as `taken`, so nothing on the same NPC shares an id, list or text group. Each
 * point's trigger is `SMART_EVENT_MOVEMENTINFORM` for waypoint movement, that point and that path:
 * `WAYPOINT_REACHED` fires twice per point on a `waypoint_data` path in this fork. Old rows are found
 * by their `AQC q<quest> patrol<entry>` tag and deleted.
 */

const SMART_KEY = ['entryorguid', 'source_type', 'id', 'link'] as const;
const TEXT_KEY = ['CreatureID', 'GroupID', 'ID'] as const;
/** `WAYPOINT_MOTION_TYPE`, the movement a `waypoint_data` patrol reports. */
const WAYPOINT_MOTION = 2;
/** A pose is undone this long before the NPC walks on. */
const POSE_UNDO_EARLY_S = 0.5;
const STYLE_TYPE = { say: TEXT_TYPE.say, yell: TEXT_TYPE.yell, emote: TEXT_TYPE.textEmote } as const;

const text = (n: number): string => String(n);
const keyOf = (row: RawRow, columns: readonly string[]): Row => Object.fromEntries(columns.map((c) => [c, row[c] ?? '0']));
const routed = (patrol: Patrol | null): patrol is Patrol => patrol !== null && patrol.points.length >= 2;

/** What an action still needs before it can be exported, in the author's words; null when it is ready. */
export function missingChoice(action: PointAction): string | null {
  switch (action.kind) {
    case 'say':
      return action.lines.some((l) => l.text.trim() !== '') ? null : 'give it a line to say';
    case 'cast':
      return action.spell > 0 ? null : 'pick the spell it casts';
    case 'sound':
      return action.sound > 0 ? null : 'pick the sound it plays';
    case 'mount':
      return action.creature > 0 ? null : 'pick what it rides';
    case 'useObject':
      return action.guid > 0 ? null : 'pick the object it uses';
    default:
      return null;
  }
}

/** A say's chance as the server reads it: a whole percent, where 0 means it never speaks. */
const chanceOf = (chance: number): number => Math.min(100, Math.max(0, Math.round(chance)));

/** Actions that are ready and can happen: nothing half-picked, no line with no chance. */
const exported = (actions: readonly PointAction[]): PointAction[] =>
  actions.filter((a) => missingChoice(a) === null && !(a.kind === 'say' && chanceOf(a.chance) === 0));

/** Whether an NPC does anything at any point of a route it walks. */
export function hasPointActions(npc: CustomNpc): boolean {
  return npc.spawns.some((s) => routed(s.patrol) && s.patrol.points.some((p) => exported(p.actions).length > 0));
}

export function compilePatrols(input: {
  questId: number;
  npcs: readonly CustomNpc[];
  context: ScriptContext;
  /** What scenes and fights wrote in this export: their rows are as good as taken. */
  taken: CompiledScripts;
}): CompiledScripts {
  const { questId, npcs, context, taken } = input;
  const out: CompiledScripts = { inserts: {}, deletes: {}, updates: [], flags: [], warnings: [] };
  const entries = new Set(npcs.map((n) => n.entry));
  const own = (comment: string | null | undefined): boolean => {
    const entry = patrolEntryOf(comment, questId);
    return entry !== null && entries.has(entry);
  };

  const sortedKeys = (rows: readonly RawRow[], columns: readonly string[]): Row[] => {
    const byText = new Map<string, Row>();
    for (const row of rows) {
      const key = keyOf(row, columns);
      byText.set(JSON.stringify(key), key);
    }
    return [...byText.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, key]) => key);
  };
  const smartDeletes = sortedKeys(context.smartScripts.filter((r) => own(r.comment)), SMART_KEY);
  const textDeletes = sortedKeys(context.creatureText.filter((r) => own(r.comment)), TEXT_KEY);
  if (smartDeletes.length > 0) out.deletes.smart_scripts = smartDeletes;
  if (textDeletes.length > 0) out.deletes.creature_text = textDeletes;

  const alloc = createAllocator({
    smartScripts: [...context.smartScripts.filter((r) => !own(r.comment)), ...(taken.inserts.smart_scripts ?? [])],
    creatureText: [...context.creatureText.filter((r) => !own(r.comment)), ...(taken.inserts.creature_text ?? [])],
  });
  const insert = (table: string, row: Row): void => {
    (out.inserts[table] ??= []).push(row);
  };

  for (const npc of npcs) {
    const entry = npc.entry;
    const tag = patrolTag(questId, entry);
    const self = (type: number, params: number[], describe: string, extra: Partial<SmartAction> = {}): SmartAction => ({
      type, params, target: TARGET.self, targetParams: [], waitMs: 0, describe, ...extra,
    });

    /** One action as SmartAI; a say also writes its lines as one text group. */
    const toSmart = (action: PointAction): SmartAction => {
      switch (action.kind) {
        case 'say': {
          const group = alloc.takeGroup(entry);
          action.lines.filter((line) => line.text.trim() !== '').forEach((line, i) => {
            insert('creature_text', {
              CreatureID: text(entry), GroupID: text(group), ID: text(i), Text: line.text, Type: text(STYLE_TYPE[line.style]), Language: '0',
              Probability: '100', Emote: '0', Duration: '0', Sound: '0', BroadcastTextId: '0', TextRange: '0',
              comment: textComment(tag, `says "${line.text}"`),
            });
          });
          return self(ACTION.talk, [group, 0, 0], 'says a line', { chance: chanceOf(action.chance) });
        }
        case 'emote':
          return self(ACTION.playEmote, [action.emote], `plays emote ${action.emote}`);
        case 'pose':
          return self(ACTION.setEmoteState, [action.emoteState], `holds pose ${action.emoteState}`);
        case 'cast':
          return self(ACTION.cast, [action.spell, 0], `casts spell ${action.spell}`);
        case 'sound':
          return self(ACTION.sound, [action.sound, 0, 0], `plays sound ${action.sound}`);
        case 'mount':
          return self(ACTION.mount, [action.creature, 0], `mounts creature ${action.creature}`);
        case 'dismount':
          return self(ACTION.mount, [0, 0], 'dismounts');
        case 'useObject':
          return { ...self(ACTION.activateObject, [0], `uses object ${action.guid}`), target: TARGET.gameobjectGuid, targetParams: [action.guid, action.entry] };
      }
    };

    for (const spawn of npc.spawns) {
      if (!routed(spawn.patrol)) continue;
      const { pathId } = spawn.patrol;
      spawn.patrol.points.forEach((point, i) => {
        const ready = exported(point.actions);
        if (ready.length === 0) return;
        const n = i + 1;
        // Each action at its time after arriving; a pose also stands back up just before leaving.
        const timeline: { at: number; action: SmartAction }[] = [];
        for (const action of ready) {
          timeline.push({ at: action.afterSecs, action: toSmart(action) });
          if (action.kind === 'pose') {
            timeline.push({ at: Math.max(action.afterSecs, point.waitSecs - POSE_UNDO_EARLY_S), action: self(ACTION.setEmoteState, [0], 'stops posing') });
          }
        }
        // A stable sort keeps actions due at the same time in the order they were added.
        timeline.sort((a, b) => a.at - b.at);
        let previous = 0;
        const actions = timeline.map(({ at, action }) => {
          const waitMs = Math.round((at - previous) * 1000);
          previous = at;
          return { ...action, waitMs };
        });
        // A fight pauses the list rather than running it mid-fight.
        const emitted = emitTrigger({
          alloc, entryorguid: entry, source: SOURCE.creature, eventType: EVENT.movementInform, eventParams: [WAYPOINT_MOTION, n, pathId],
          actions, header: `${tag}: spawn ${spawn.guid} point ${n}`, tag, shape: 'list', listOverride: true, listOutOfCombat: true,
        });
        if (emitted === null) {
          out.warnings.push(`No free timed action list id for NPC ${entry}.`);
          return;
        }
        for (const row of emitted.rows) insert('smart_scripts', row);
      });
    }

    // A fight's own list can replace a point's before its stand-up step, so the NPC stops posing as
    // the fight starts, on a row of its own that leaves every list alone.
    const poses = npc.spawns.some((s) => routed(s.patrol) && s.patrol.points.some((p) => exported(p.actions).some((a) => a.kind === 'pose')));
    if (poses) {
      const stop = emitTrigger({
        alloc, entryorguid: entry, source: SOURCE.creature, eventType: EVENT.aggro, eventParams: [],
        actions: [self(ACTION.setEmoteState, [0], 'stops posing')], header: `${tag}: stops posing when a fight starts`, tag, shape: 'link',
      });
      for (const row of stop?.rows ?? []) insert('smart_scripts', row);
    }
  }
  return out;
}

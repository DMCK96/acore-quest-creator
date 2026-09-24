import type { RawRow } from '../db/types';
import type { CustomNpc } from '../entities/model';
import type { CompiledScripts } from '../scripts/compile';
import type { ScriptContext } from '../scripts/context';
import { createAllocator, emitTrigger, type Row, type SmartAction, type SmartAllocator } from '../scripts/rows';
import { fightEntryOf, fightTag } from '../scripts/tag';
import { ACTION, EVENT, SOURCE, TARGET, TEXT_TYPE } from '../smartai/ids';
import { AUTO_LINES, describeAbility, describeFightStep, describeReaction } from './describe';
import {
  autoCleanupEntries, fightIsEmpty, hasSurrender, phaseMask, PHASED_WHEN, summonedEntries,
  type CastTarget, type Fight, type FightStep, type Reaction, type ReactionKind, type ReactionWhen,
} from './model';

/**
 * New NPCs' fights to SmartAI rows. Runs after the scene compiler, taking the rows it just wrote as
 * `taken`, so scenes and fights on the same NPC never share an id, list or text group. Pure and
 * deterministic, like the scene compiler: the same fights against the same context give the same
 * rows. Old fight rows are found by their `AQC q<quest> fight<entry>` tag and deleted.
 */

const SMART_KEY = ['entryorguid', 'source_type', 'id', 'link'] as const;
const TEXT_KEY = ['CreatureID', 'GroupID', 'ID'] as const;

const TARGET_OF: Record<CastTarget, number> = {
  victim: TARGET.victim,
  secondThreat: TARGET.secondAggro,
  random: TARGET.hostileRandom,
  randomNotTank: TARGET.hostileRandomNotTop,
  self: TARGET.self,
  hurtFriend: TARGET.invoker,
};

/** `SMARTCAST_COMBAT_MOVE | SMARTCAST_MAIN_SPELL`: keeps at range while it can cast the spell. */
const CAST_KEEP_DISTANCE = 0x440;
/** `SMARTCAST_AURA_NOT_PRESENT`. */
const CAST_SKIP_IF_AURA = 0x20;
const NOT_REPEATABLE = 1;
/** `TEMPSUMMON_CORPSE_TIMED_DESPAWN`, and how long a dead add's corpse stays. */
const SUMMON_CORPSE_TIMED = 6;
const ADD_CORPSE_MS = 10000;
const DESPAWN_RANGE = 100;
const FRIENDLY_FACTION = 35;
const RESTORE_MS = 120000;
/** Triggers whose invoker is a player the NPC fights, so a line can name them. */
const PLAYER_INVOKER: ReadonlySet<ReactionKind> = new Set(['aggro', 'healthBelow', 'kill', 'death']);

const text = (n: number): string => String(n);
const keyOf = (row: RawRow, columns: readonly string[]): Row => Object.fromEntries(columns.map((c) => [c, row[c] ?? '0']));

export function compileFights(input: {
  questId: number;
  npcs: readonly CustomNpc[];
  /** `quest_template.RequiredNpcOrGo`; index 0 is objective 1. */
  objectives: readonly number[];
  context: ScriptContext;
  /** What the scene compiler wrote in this export: its rows are as good as taken. */
  taken: CompiledScripts;
}): CompiledScripts {
  const { questId, npcs, objectives, context, taken } = input;
  const out: CompiledScripts = { inserts: {}, deletes: {}, updates: [], flags: [], warnings: [] };
  const entries = new Set(npcs.map((n) => n.entry));
  const own = (comment: string | null | undefined): boolean => {
    const entry = fightEntryOf(comment, questId);
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
    if (fightIsEmpty(npc.fight)) continue;
    compileOne(npc.entry, npc.fight!, { questId, objectives, alloc, insert, warn: (w) => out.warnings.push(w) });
  }
  return out;
}

interface Sink {
  questId: number;
  objectives: readonly number[];
  alloc: SmartAllocator;
  insert(table: string, row: Row): void;
  warn(message: string): void;
}

function compileOne(entry: number, fight: Fight, sink: Sink): void {
  const { alloc, insert } = sink;
  const tag = fightTag(sink.questId, entry);
  const source = SOURCE.creature;
  const emit = (eventType: number, eventParams: readonly number[], actions: SmartAction[], header: string, extra: { shape?: 'list' | 'link'; phaseMask?: number; eventFlags?: number } = {}): void => {
    if (actions.length === 0) return;
    const emitted = emitTrigger({ alloc, entryorguid: entry, source, eventType, eventParams, actions, header: `${tag}: ${header}`, tag, shape: extra.shape ?? 'list', phaseMask: extra.phaseMask, eventFlags: extra.eventFlags });
    if (emitted === null) {
      sink.warn(`No free timed action list id for NPC ${entry}.`);
      return;
    }
    for (const row of emitted.rows) insert('smart_scripts', row);
  };
  const action = (type: number, params: number[], target: number, extra: Partial<SmartAction> = {}): SmartAction => ({
    type, params, target, targetParams: [], waitMs: 0, describe: '', ...extra,
  });

  for (const ability of fight.abilities) {
    const once = ability.repeatMinS === 0 && ability.repeatMaxS === 0;
    const flags = (ability.keepDistance ? CAST_KEEP_DISTANCE : 0) | (ability.skipIfAuraPresent ? CAST_SKIP_IF_AURA : 0);
    const ms = (s: number): number => Math.round(s * 1000);
    emit(
      EVENT.updateIc,
      [ms(ability.firstMinS), ms(ability.firstMaxS), ms(ability.repeatMinS), ms(ability.repeatMaxS)],
      [action(ACTION.cast, [ability.spellId, flags], TARGET_OF[ability.target])],
      describeAbility(ability, fight),
      { phaseMask: phaseMask(ability.phases), eventFlags: once ? NOT_REPEATABLE : 0 },
    );
  }

  if (fight.phases.length > 0) {
    emit(EVENT.aggro, [], [action(ACTION.setEventPhase, [1], TARGET.self)], AUTO_LINES.phaseStart(fight));
  }

  for (const reaction of fight.reactions) {
    const actions = reaction.steps.flatMap((step) => stepActions(step, reaction));
    const [eventType, eventParams] = triggerOf(reaction.when);
    emit(eventType, eventParams, actions, describeReaction(reaction, fight), {
      shape: reaction.when.kind === 'death' ? 'link' : 'list',
      phaseMask: PHASED_WHEN.has(reaction.when.kind) ? phaseMask(reaction.phases) : 0,
      eventFlags: reaction.when.kind === 'healthBelow' ? NOT_REPEATABLE : 0,
    });
  }

  const cleanup = autoCleanupEntries(fight);
  if (cleanup.length > 0) {
    emit(EVENT.evade, [], cleanup.map((e) => despawn(e, 'despawn its adds')), AUTO_LINES.cleanup, { shape: 'link' });
  }
  if (hasSurrender(fight)) {
    emit(EVENT.updateOoc, [RESTORE_MS, RESTORE_MS, RESTORE_MS, RESTORE_MS], [action(ACTION.setFaction, [0], TARGET.self)], AUTO_LINES.restore);
  }

  function despawn(addEntry: number, describe: string): SmartAction {
    return action(ACTION.forceDespawn, [0], TARGET.creatureRange, { targetParams: [addEntry, 0, DESPAWN_RANGE], describe });
  }

  function stepActions(step: FightStep, reaction: Reaction): SmartAction[] {
    const describe = describeFightStep(step, fight);
    const first = (list: SmartAction[]): SmartAction[] => list.map((a, i) => ({ ...a, describe, waitMs: i === 0 ? step.waitMs : 0 }));
    switch (step.kind) {
      case 'say': {
        const group = alloc.takeGroup(entry);
        const type = step.style === 'yell' ? TEXT_TYPE.yell : step.style === 'emote' ? TEXT_TYPE.textEmote : TEXT_TYPE.say;
        insert('creature_text', {
          CreatureID: text(entry), GroupID: text(group), ID: '0', Text: step.text, Type: text(type), Language: '0',
          Probability: '100', Emote: '0', Duration: '0', Sound: '0', BroadcastTextId: '0', TextRange: '0',
          comment: `${tag}: ${describe}`,
        });
        const named = PLAYER_INVOKER.has(reaction.when.kind);
        return first([action(ACTION.talk, [group, 0, named ? 1 : 0], named ? TARGET.invoker : TARGET.self)]);
      }
      case 'emote':
        return first([action(ACTION.playEmote, [step.emote], TARGET.self)]);
      case 'credit':
        return first([action(ACTION.killedMonster, [sink.objectives[step.objective - 1] ?? 0], step.group ? TARGET.invokerParty : TARGET.invoker)]);
      case 'cast':
        return first([action(ACTION.cast, [step.spellId, 0], TARGET_OF[step.target])]);
      case 'summonAdds': {
        const params = [step.entry, SUMMON_CORPSE_TIMED, ADD_CORPSE_MS, step.attack ? 1 : 0];
        const one = step.at === 'aroundMe'
          ? action(ACTION.summonCreature, params, TARGET.self)
          : action(ACTION.summonCreature, params, TARGET.position, { at: step.at });
        return first(Array.from({ length: step.count }, () => one));
      }
      case 'despawnAdds': {
        // Entry 0 must never reach the row: a creature-range target with entry 0 is every creature.
        const targets = step.entry > 0 ? [step.entry] : summonedEntries(fight);
        return first(targets.map((e) => despawn(e, describe)));
      }
      case 'goToPhase':
        return first([action(ACTION.setEventPhase, [step.phase], TARGET.self)]);
      case 'flee':
        return first([action(ACTION.fleeForAssist, [1], TARGET.self)]);
      case 'callForHelp':
        return first([action(ACTION.callForHelp, [step.radius, 1], TARGET.self)]);
      case 'holdAtHealth':
        return first([action(ACTION.setInvincibilityHpLevel, [0, step.pct], TARGET.self)]);
      case 'surrender':
        return first([action(ACTION.setFaction, [FRIENDLY_FACTION], TARGET.self), action(ACTION.evade, [], TARGET.self)]);
    }
  }
}

/** A reaction's event and its params. */
function triggerOf(when: ReactionWhen): [number, number[]] {
  switch (when.kind) {
    case 'aggro':
      return [EVENT.aggro, []];
    case 'healthBelow':
      return [EVENT.healthPct, [0, when.pct]];
    case 'friendHealthBelow':
      // First look after 1–3 s, then every 10–15 s, for a friend below the percentage in range.
      return [EVENT.friendlyHealthPct, [1000, 3000, 10000, 15000, when.pct, when.range]];
    case 'addDies':
      return [EVENT.summonedUnitDies, [when.entry]];
    case 'kill':
      // No cooldown, players only.
      return [EVENT.kill, [0, 0, 1]];
    case 'death':
      return [EVENT.death, []];
    case 'evade':
      return [EVENT.evade, []];
  }
}

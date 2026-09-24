import { z } from 'zod';
import { positionSchema } from '../scripts/model';

/**
 * A new NPC's fight as the author sees it: abilities it casts on timers, reactions to what happens
 * during the fight (health thresholds, aggro, adds dying, death, reset), and phases that stay out of
 * sight until a reaction first moves the fight to one. Stored on the NPC (`CustomNpc.fight`) and
 * compiled into SmartAI rows at export (`compile.ts`).
 */

const int = z.number().int();
const num = z.number().finite();
const seconds = num;
const wait = { waitMs: int.min(0) };

export const ABILITY_TARGETS = ['victim', 'secondThreat', 'random', 'randomNotTank', 'self'] as const;
const abilityTarget = z.enum(ABILITY_TARGETS);
const castTarget = z.enum([...ABILITY_TARGETS, 'hurtFriend']);
const phases = z.array(int.min(1));

const abilitySchema = z.object({
  id: z.string(),
  spellId: int,
  target: abilityTarget,
  firstMinS: seconds,
  firstMaxS: seconds,
  repeatMinS: seconds,
  repeatMaxS: seconds,
  keepDistance: z.boolean(),
  skipIfAuraPresent: z.boolean(),
  phases,
});

const whenSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('aggro') }),
  z.object({ kind: z.literal('healthBelow'), pct: num }),
  z.object({ kind: z.literal('friendHealthBelow'), pct: num, range: num }),
  z.object({ kind: z.literal('addDies'), entry: int }),
  z.object({ kind: z.literal('kill') }),
  z.object({ kind: z.literal('death') }),
  z.object({ kind: z.literal('evade') }),
]);

// `say`, `emote` and `credit` have the fields of the scene steps of the same kind, so the scene
// descriptions and editors work on them unchanged.
const stepSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('say'), text: z.string(), style: z.enum(['say', 'yell', 'emote']), ...wait }),
  z.object({ kind: z.literal('emote'), emote: int, ...wait }),
  z.object({ kind: z.literal('cast'), spellId: int, target: castTarget, ...wait }),
  z.object({
    kind: z.literal('summonAdds'), entry: int, count: int.min(1), at: z.union([z.literal('aroundMe'), positionSchema]), attack: z.boolean(), ...wait,
  }),
  z.object({ kind: z.literal('despawnAdds'), entry: int, ...wait }),
  z.object({ kind: z.literal('goToPhase'), phase: int.min(1), ...wait }),
  z.object({ kind: z.literal('flee'), ...wait }),
  z.object({ kind: z.literal('callForHelp'), radius: num, ...wait }),
  z.object({ kind: z.literal('holdAtHealth'), pct: num, ...wait }),
  z.object({ kind: z.literal('surrender'), ...wait }),
  z.object({ kind: z.literal('credit'), objective: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]), group: z.boolean(), ...wait }),
]);

const reactionSchema = z.object({ id: z.string(), when: whenSchema, phases, steps: z.array(stepSchema) });

export const fightSchema = z.object({
  /** Empty means the fight has no phases; otherwise it enters phase 1 on aggro. */
  phases: z.array(z.string()),
  abilities: z.array(abilitySchema),
  reactions: z.array(reactionSchema),
});

export type AbilityTarget = z.infer<typeof abilityTarget>;
export type CastTarget = z.infer<typeof castTarget>;
export type Ability = z.infer<typeof abilitySchema>;
export type ReactionWhen = z.infer<typeof whenSchema>;
export type ReactionKind = ReactionWhen['kind'];
export type FightStep = z.infer<typeof stepSchema>;
export type FightStepKind = FightStep['kind'];
export type Reaction = z.infer<typeof reactionSchema>;
export type Fight = z.infer<typeof fightSchema>;

/** Reactions that can be limited to phases; aggro, death and reset happen whatever the phase. */
export const PHASED_WHEN: ReadonlySet<ReactionKind> = new Set(['healthBelow', 'friendHealthBelow', 'addDies', 'kill']);

export function emptyFight(): Fight {
  return { phases: [], abilities: [], reactions: [] };
}

/** `<prefix><n+1>` past the highest `<prefix><n>` in use, so a removed item's id is never reused. */
export function nextId(prefix: 'a' | 'r', items: readonly { id: string }[]): string {
  const pattern = new RegExp(`^${prefix}(\\d+)$`);
  let highest = 0;
  for (const item of items) {
    const match = pattern.exec(item.id);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `${prefix}${highest + 1}`;
}

export function newAbility(fight: Fight): Ability {
  return {
    id: nextId('a', fight.abilities), spellId: 0, target: 'victim', firstMinS: 2, firstMaxS: 4, repeatMinS: 8, repeatMaxS: 12,
    keepDistance: false, skipIfAuraPresent: false, phases: [],
  };
}

export function newReaction(fight: Fight, when: ReactionWhen): Reaction {
  return { id: nextId('r', fight.reactions), when, phases: [], steps: [] };
}

/** The fight with phases up to `phase`, the missing ones named "Phase n"; unchanged when it has them. */
export function withPhase(fight: Fight, phase: number): Fight {
  if (phase <= fight.phases.length) return fight;
  const names = [...fight.phases];
  for (let i = names.length + 1; i <= phase; i += 1) names.push(`Phase ${i}`);
  return { ...fight, phases: names };
}

/** `event_phase_mask` for 1-based phases; 0 (every phase) for none. */
export function phaseMask(list: readonly number[]): number {
  return list.reduce((mask, p) => mask | (1 << (p - 1)), 0);
}

/** A fight that writes nothing: none at all, or one without abilities and reactions. */
export function fightIsEmpty(fight: Fight | null): boolean {
  return fight === null || (fight.abilities.length === 0 && fight.reactions.length === 0);
}

const allSteps = (fight: Fight): FightStep[] => fight.reactions.flatMap((r) => r.steps);

/** The NPCs the fight summons, each once, in the order they first appear. */
export function summonedEntries(fight: Fight): number[] {
  const entries: number[] = [];
  for (const step of allSteps(fight)) {
    if (step.kind === 'summonAdds' && step.entry > 0 && !entries.includes(step.entry)) entries.push(step.entry);
  }
  return entries;
}

/** Adds the compiler despawns on reset because the author did not say what happens to them. */
export function autoCleanupEntries(fight: Fight): number[] {
  const handled = fight.reactions.some((r) => r.when.kind === 'evade' && r.steps.some((s) => s.kind === 'despawnAdds'));
  return handled ? [] : summonedEntries(fight);
}

export function hasSurrender(fight: Fight): boolean {
  return allSteps(fight).some((s) => s.kind === 'surrender');
}

/** Ids of the abilities and reactions that use a phase, in fight order. */
export function phaseUses(fight: Fight, phase: number): string[] {
  const ids: string[] = [];
  for (const ability of fight.abilities) if (ability.phases.includes(phase)) ids.push(ability.id);
  for (const reaction of fight.reactions) {
    if (reaction.phases.includes(phase) || reaction.steps.some((s) => s.kind === 'goToPhase' && s.phase === phase)) ids.push(reaction.id);
  }
  return ids;
}

/** The fight without a phase, later phases moved down one; null while something still uses it. */
export function removePhase(fight: Fight, phase: number): Fight | null {
  if (phaseUses(fight, phase).length > 0) return null;
  const shift = (p: number): number => (p > phase ? p - 1 : p);
  return {
    phases: fight.phases.filter((_, i) => i !== phase - 1),
    abilities: fight.abilities.map((a) => ({ ...a, phases: a.phases.map(shift) })),
    reactions: fight.reactions.map((r) => ({
      ...r,
      phases: r.phases.map(shift),
      steps: r.steps.map((s) => (s.kind === 'goToPhase' ? { ...s, phase: shift(s.phase) } : s)),
    })),
  };
}

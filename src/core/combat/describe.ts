import { describeStep } from '../scripts/describe';
import type { StepBody } from '../scripts/model';
import { autoCleanupEntries, hasSurrender, type Ability, type CastTarget, type Fight, type FightStep, type Reaction, type ReactionWhen } from './model';

/** A fight in the words the editor's summary and the row comments use. */

/** A spell's name when the spell list is loaded; undefined otherwise. */
export type SpellName = (id: number) => string | undefined;

export const TARGET_WORDS: Record<CastTarget, string> = {
  victim: 'its current target',
  secondThreat: 'the second on its threat list',
  random: 'a random enemy',
  randomNotTank: 'a random enemy other than the tank',
  self: 'itself',
  hurtFriend: 'the hurt friend',
};

function spellWord(id: number, spell?: SpellName): string {
  if (id === 0) return 'a spell (not chosen)';
  const name = spell?.(id);
  return name ? name : `spell ${id}`;
}

const span = (min: number, max: number): string => (min === max ? `${min} s` : `${min}–${max} s`);

const phaseName = (fight: Fight, phase: number): string => fight.phases[phase - 1] ?? `phase ${phase}`;

function phaseSuffix(fight: Fight, phases: readonly number[]): string {
  if (fight.phases.length === 0 || phases.length === 0) return '';
  return ` (in ${phases.map((p) => phaseName(fight, p)).join(' and ')})`;
}

export function describeAbility(a: Ability, fight: Fight, spell?: SpellName): string {
  const once = a.repeatMinS === 0 && a.repeatMaxS === 0;
  let line = `Casts ${spellWord(a.spellId, spell)} on ${TARGET_WORDS[a.target]}`;
  line += once ? ` once, after ${span(a.firstMinS, a.firstMaxS)}` : ` every ${span(a.repeatMinS, a.repeatMaxS)} (first after ${span(a.firstMinS, a.firstMaxS)})`;
  if (a.keepDistance) line += ', staying at range';
  if (a.skipIfAuraPresent) line += ', unless it is still on them';
  return line + phaseSuffix(fight, a.phases);
}

export function describeWhen(w: ReactionWhen): string {
  switch (w.kind) {
    case 'aggro':
      return 'When it enters combat';
    case 'healthBelow':
      return `At ${w.pct}% health`;
    case 'friendHealthBelow':
      return `When a friend within ${w.range} yd drops below ${w.pct}% health`;
    case 'addDies':
      return w.entry === 0 ? 'When one of its adds dies' : `When its add NPC ${w.entry} dies`;
    case 'kill':
      return 'When it kills a player';
    case 'death':
      return 'When it dies';
    case 'evade':
      return 'When it gives up and resets';
  }
}

export function describeFightStep(s: FightStep, fight: Fight, spell?: SpellName): string {
  switch (s.kind) {
    case 'say':
    case 'emote':
    case 'credit':
      return describeStep(s as StepBody);
    case 'cast':
      return `cast ${spellWord(s.spellId, spell)} on ${TARGET_WORDS[s.target]}`;
    case 'summonAdds':
      return `summon ${s.count} × NPC ${s.entry}${s.at === 'aroundMe' ? ' around itself' : ' at a point'}${s.attack ? ' to attack' : ''}`;
    case 'despawnAdds':
      return s.entry === 0 ? 'despawn its adds' : `despawn its adds of NPC ${s.entry}`;
    case 'goToPhase':
      return `go to phase ${s.phase}: ${fight.phases[s.phase - 1] ?? `Phase ${s.phase}`}`;
    case 'flee':
      return 'flee for help';
    case 'callForHelp':
      return `call for help within ${s.radius} yd`;
    case 'holdAtHealth':
      return `stop taking damage at ${s.pct}% health`;
    case 'surrender':
      return 'stop fighting and turn friendly';
  }
}

export function describeReaction(r: Reaction, fight: Fight, spell?: SpellName): string {
  const steps = r.steps.length === 0 ? 'nothing yet' : r.steps.map((s) => describeFightStep(s, fight, spell)).join(', then ');
  return `${describeWhen(r.when)}${phaseSuffix(fight, r.phases)}: ${steps}`;
}

/** The lines for rows the compiler adds on the author's behalf. */
export const AUTO_LINES = {
  phaseStart: (fight: Fight): string => `When it enters combat: go to phase 1: ${fight.phases[0] ?? 'Phase 1'} (added automatically)`,
  cleanup: 'When it resets: despawn its adds (added automatically)',
  restore: 'Out of combat: turns hostile again within two minutes of surrendering (added automatically)',
};

/** One line per ability, reaction and automatic row, in the order the compiler writes them. */
export function describeFight(fight: Fight, spell?: SpellName): string[] {
  const lines = fight.abilities.map((a) => describeAbility(a, fight, spell));
  if (fight.phases.length > 0) lines.push(AUTO_LINES.phaseStart(fight));
  for (const r of fight.reactions) lines.push(describeReaction(r, fight, spell));
  if (autoCleanupEntries(fight).length > 0) lines.push(AUTO_LINES.cleanup);
  if (hasSurrender(fight)) lines.push(AUTO_LINES.restore);
  return lines;
}

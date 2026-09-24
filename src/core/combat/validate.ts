import { ENTITIES_FIELD } from '../entities/model';
import type { Issue } from '../validate/validate';
import { summonedEntries, type Fight } from './model';

/**
 * What is wrong with a new NPC's fight. Each problem is reported once per fight, prefixed with the
 * NPC's label, and routed to the NPCs & objects module like the other entity issues.
 */
export function fightIssues(fight: Fight, label: string, knownSpell: ((id: number) => boolean) | null): Issue[] {
  const issues: Issue[] = [];
  const seen = new Set<string>();
  const add = (severity: Issue['severity'], code: string, message: string): void => {
    if (seen.has(code)) return;
    seen.add(code);
    issues.push({ severity, code, fieldId: ENTITIES_FIELD, message: `${label}: ${message}` });
  };
  const steps = fight.reactions.flatMap((r) => r.steps);
  const spells = [
    ...fight.abilities.map((a) => a.spellId),
    ...steps.flatMap((s) => (s.kind === 'cast' ? [s.spellId] : [])),
  ];
  const badPct = (pct: number): boolean => pct < 1 || pct > 99;
  const phaseCount = fight.phases.length;
  const missingPhase = (list: readonly number[]): boolean => list.some((p) => p > phaseCount);
  const reached = new Set(steps.flatMap((s) => (s.kind === 'goToPhase' ? [s.phase] : [])));

  if (spells.some((id) => id <= 0)) add('error', 'FIGHT_NO_SPELL', 'an ability or cast step has no spell; pick one.');
  for (const a of fight.abilities) {
    const times = [a.firstMinS, a.firstMaxS, a.repeatMinS, a.repeatMaxS];
    if (times.some((t) => t < 0) || a.firstMinS > a.firstMaxS || a.repeatMinS > a.repeatMaxS || (a.repeatMinS === 0 && a.repeatMaxS > 0)) {
      add('error', 'FIGHT_TIMING', 'an ability\'s times are out of order; none may be below 0, and each "from" must be no more than its "to".');
    }
  }
  const pcts = [
    ...fight.reactions.flatMap((r) => (r.when.kind === 'healthBelow' || r.when.kind === 'friendHealthBelow' ? [r.when.pct] : [])),
    ...steps.flatMap((s) => (s.kind === 'holdAtHealth' ? [s.pct] : [])),
  ];
  if (pcts.some(badPct)) add('error', 'FIGHT_HEALTH_PCT', 'a health percentage must be between 1 and 99.');
  if (steps.some((s) => s.kind === 'summonAdds' && s.entry <= 0)) add('error', 'FIGHT_NO_ADD', 'a summon step has no NPC; pick the add.');
  if (
    fight.abilities.some((a) => missingPhase(a.phases)) ||
    fight.reactions.some((r) => missingPhase(r.phases)) ||
    steps.some((s) => s.kind === 'goToPhase' && s.phase > phaseCount)
  ) {
    add('error', 'FIGHT_PHASE_MISSING', 'something uses a phase the fight does not have.');
  }
  const mains = fight.abilities.filter((a) => a.keepDistance);
  const overlap = (x: readonly number[], y: readonly number[]): boolean => x.length === 0 || y.length === 0 || x.some((p) => y.includes(p));
  if (mains.some((a, i) => mains.slice(i + 1).some((b) => overlap(a.phases, b.phases)))) {
    add('error', 'FIGHT_TWO_MAIN_SPELLS', 'only one ability at a time can keep it at range; untick "Stays at range" on the others.');
  }
  for (let p = 2; p <= phaseCount; p += 1) {
    if (!reached.has(p)) add('warning', 'FIGHT_PHASE_UNREACHED', `nothing leads to phase ${p} (${fight.phases[p - 1]}); add a "Go to phase" step.`);
  }
  if (knownSpell && spells.some((id) => id > 0 && !knownSpell(id))) {
    add('warning', 'FIGHT_UNKNOWN_SPELL', 'a spell is not in the server\'s spell list.');
  }
  if (fight.reactions.some((r) => r.steps.length === 0)) add('warning', 'FIGHT_EMPTY_REACTION', 'a reaction does nothing yet; add a step or remove it.');
  if (fight.abilities.some((a) => a.repeatMinS > 0 && a.repeatMinS < 2)) {
    add('warning', 'FIGHT_TOO_FAST', 'an ability repeats faster than every 2 seconds.');
  }
  if (fight.reactions.some((r) => r.when.kind === 'death' && r.steps.some((s) => s.waitMs > 0))) {
    add('warning', 'FIGHT_DEATH_WAIT', 'a dead NPC does not wait between steps, so its death steps all happen at once.');
  }
  if (summonedEntries(fight).length === 0 && steps.some((s) => s.kind === 'despawnAdds' && s.entry === 0)) {
    add('warning', 'FIGHT_NOTHING_TO_DESPAWN', '"Despawn its adds" does nothing: the fight summons no adds.');
  }
  return issues;
}

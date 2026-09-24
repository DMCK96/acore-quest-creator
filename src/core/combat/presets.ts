import { emptyFight, newAbility, newReaction, withPhase, type Ability, type Fight, type Reaction, type ReactionWhen, type FightStep } from './model';

/**
 * Starting points for common fights, taken from what stock creature scripts do most. A preset adds
 * to the fight it is given; spells and adds are left for the author to pick, so the fight's checks
 * point at exactly those choices.
 */

export type PresetId = 'melee' | 'caster' | 'flee15' | 'enrage30' | 'adds50' | 'twoPhase' | 'surrender20';

export const PRESETS: readonly { id: PresetId; label: string }[] = [
  { id: 'melee', label: 'Melee with one ability' },
  { id: 'caster', label: 'Caster' },
  { id: 'flee15', label: 'Flee at 15%' },
  { id: 'enrage30', label: 'Enrage at 30%' },
  { id: 'adds50', label: 'Adds at 50%' },
  { id: 'twoPhase', label: 'Two-phase boss' },
  { id: 'surrender20', label: 'Surrenders at 20%' },
];

const withAbility = (fight: Fight, over: Partial<Ability>): Fight => ({ ...fight, abilities: [...fight.abilities, { ...newAbility(fight), ...over }] });

const withReaction = (fight: Fight, when: ReactionWhen, steps: FightStep[], over: Partial<Reaction> = {}): Fight =>
  ({ ...fight, reactions: [...fight.reactions, { ...newReaction(fight, when), steps, ...over }] });

export function applyPreset(fight: Fight | null, id: PresetId): Fight {
  const base = fight ?? emptyFight();
  switch (id) {
    case 'melee':
      return withAbility(base, { firstMinS: 3, firstMaxS: 6, repeatMinS: 10, repeatMaxS: 15 });
    case 'caster': {
      const main = withAbility(base, { keepDistance: true, firstMinS: 0, firstMaxS: 0, repeatMinS: 3, repeatMaxS: 5 });
      return withAbility(main, { firstMinS: 5, firstMaxS: 10, repeatMinS: 15, repeatMaxS: 20 });
    }
    case 'flee15':
      return withReaction(base, { kind: 'healthBelow', pct: 15 }, [{ kind: 'flee', waitMs: 0 }]);
    case 'enrage30':
      return withReaction(base, { kind: 'healthBelow', pct: 30 }, [{ kind: 'cast', spellId: 0, target: 'self', waitMs: 0 }]);
    case 'adds50':
      return withReaction(base, { kind: 'healthBelow', pct: 50 }, [
        { kind: 'summonAdds', entry: 0, count: 2, at: 'aroundMe', attack: true, waitMs: 0 },
      ]);
    case 'twoPhase': {
      const phased = withPhase(base, 2);
      const first: Fight = { ...phased, abilities: phased.abilities.map((a) => (a.phases.length === 0 ? { ...a, phases: [1] } : a)) };
      return withReaction(withAbility(first, { phases: [2] }), { kind: 'healthBelow', pct: 50 }, [{ kind: 'goToPhase', phase: 2, waitMs: 0 }], { phases: [1] });
    }
    case 'surrender20': {
      const held = withReaction(base, { kind: 'aggro' }, [{ kind: 'holdAtHealth', pct: 20, waitMs: 0 }]);
      return withReaction(held, { kind: 'healthBelow', pct: 20 }, [
        { kind: 'say', text: 'I yield! I yield!', style: 'say', waitMs: 0 },
        { kind: 'surrender', waitMs: 0 },
        { kind: 'credit', objective: 1, group: false, waitMs: 0 },
      ]);
    }
  }
}

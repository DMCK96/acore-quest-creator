import { describe, expect, it } from 'vitest';
import { applyPreset, PRESETS } from '../../src/core/combat/presets';
import { emptyFight, newAbility } from '../../src/core/combat/model';
import { fightIssues } from '../../src/core/combat/validate';

describe('presets', () => {
  it('lists every preset with an author-facing label', () => {
    expect(PRESETS.map((p) => p.label)).toEqual([
      'Melee with one ability', 'Caster', 'Flee at 15%', 'Enrage at 30%', 'Adds at 50%', 'Two-phase boss', 'Surrenders at 20%',
    ]);
  });
  it('starts a fight from nothing and adds to an existing one with fresh ids', () => {
    const melee = applyPreset(null, 'melee');
    expect(melee.abilities).toEqual([{ ...newAbility(emptyFight()), id: 'a1', firstMinS: 3, firstMaxS: 6, repeatMinS: 10, repeatMaxS: 15 }]);
    const more = applyPreset(melee, 'flee15');
    expect(more.abilities).toHaveLength(1);
    expect(more.reactions).toEqual([{ id: 'r1', when: { kind: 'healthBelow', pct: 15 }, phases: [], steps: [{ kind: 'flee', waitMs: 0 }] }]);
  });
  it('builds a caster that keeps its distance', () => {
    const f = applyPreset(null, 'caster');
    expect(f.abilities.map((x) => [x.keepDistance, x.firstMinS, x.firstMaxS, x.repeatMinS, x.repeatMaxS])).toEqual([[true, 0, 0, 3, 5], [false, 5, 10, 15, 20]]);
  });
  it('builds a two-phase boss around the abilities already there', () => {
    const f = applyPreset(applyPreset(null, 'melee'), 'twoPhase');
    expect(f.phases).toEqual(['Phase 1', 'Phase 2']);
    expect(f.abilities.map((x) => [x.id, x.phases])).toEqual([['a1', [1]], ['a2', [2]]]);
    expect(f.reactions).toEqual([{ id: 'r1', when: { kind: 'healthBelow', pct: 50 }, phases: [1], steps: [{ kind: 'goToPhase', phase: 2, waitMs: 0 }] }]);
  });
  it('builds a surrender for "defeat" quests', () => {
    const f = applyPreset(null, 'surrender20');
    expect(f.reactions).toEqual([
      { id: 'r1', when: { kind: 'aggro' }, phases: [], steps: [{ kind: 'holdAtHealth', pct: 20, waitMs: 0 }] },
      { id: 'r2', when: { kind: 'healthBelow', pct: 20 }, phases: [], steps: [
        { kind: 'say', text: 'I yield! I yield!', style: 'say', waitMs: 0 },
        { kind: 'surrender', waitMs: 0 },
        { kind: 'credit', objective: 1, group: false, waitMs: 0 },
      ] },
    ]);
  });
  it('leaves only the choices the author must make as errors', () => {
    for (const { id } of PRESETS) {
      const errors = fightIssues(applyPreset(null, id), 'x', null).filter((i) => i.severity === 'error').map((i) => i.code);
      expect(errors.every((c) => c === 'FIGHT_NO_SPELL' || c === 'FIGHT_NO_ADD'), id).toBe(true);
    }
  });
});

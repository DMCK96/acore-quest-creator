import { describe, expect, it } from 'vitest';
import { AUTO_LINES, describeAbility, describeFight, describeFightStep, describeReaction, describeWhen } from '../../src/core/combat/describe';
import { emptyFight, newAbility, type Fight } from '../../src/core/combat/model';

const a = { ...newAbility(emptyFight()), spellId: 116 };
const names = (id: number) => (id === 116 ? 'Frostbolt' : undefined);
const f = emptyFight();

describe('describe', () => {
  it('describes abilities', () => {
    expect(describeAbility(a, f)).toBe('Casts spell 116 on its current target every 8–12 s (first after 2–4 s)');
    expect(describeAbility(a, f, names)).toBe('Casts Frostbolt on its current target every 8–12 s (first after 2–4 s)');
    expect(describeAbility({ ...a, repeatMinS: 0, repeatMaxS: 0, firstMinS: 5, firstMaxS: 5 }, f)).toBe('Casts spell 116 on its current target once, after 5 s');
    expect(describeAbility({ ...a, spellId: 0, target: 'randomNotTank', keepDistance: true, skipIfAuraPresent: true }, f))
      .toBe('Casts a spell (not chosen) on a random enemy other than the tank every 8–12 s (first after 2–4 s), staying at range, unless it is still on them');
    expect(describeAbility({ ...a, phases: [1, 2] }, { ...f, phases: ['Ground', 'Air'] })).toBe('Casts spell 116 on its current target every 8–12 s (first after 2–4 s) (in Ground and Air)');
  });

  it('describes triggers', () => {
    expect(describeWhen({ kind: 'aggro' })).toBe('When it enters combat');
    expect(describeWhen({ kind: 'healthBelow', pct: 30 })).toBe('At 30% health');
    expect(describeWhen({ kind: 'friendHealthBelow', pct: 40, range: 30 })).toBe('When a friend within 30 yd drops below 40% health');
    expect(describeWhen({ kind: 'addDies', entry: 0 })).toBe('When one of its adds dies');
    expect(describeWhen({ kind: 'addDies', entry: 7 })).toBe('When its add NPC 7 dies');
    expect(describeWhen({ kind: 'kill' })).toBe('When it kills a player');
    expect(describeWhen({ kind: 'death' })).toBe('When it dies');
    expect(describeWhen({ kind: 'evade' })).toBe('When it gives up and resets');
  });

  it('describes steps, reusing the scene words for say, emote and credit', () => {
    const p: Fight = { ...f, phases: ['Ground', 'Air'] };
    const d = (s: Parameters<typeof describeFightStep>[0]) => describeFightStep(s, p, names);
    expect(d({ kind: 'say', text: 'Die!', style: 'yell', waitMs: 0 })).toBe('yell "Die!"');
    expect(d({ kind: 'credit', objective: 1, group: false, waitMs: 0 })).toBe('give the player credit for objective 1');
    expect(d({ kind: 'cast', spellId: 116, target: 'hurtFriend', waitMs: 0 })).toBe('cast Frostbolt on the hurt friend');
    expect(d({ kind: 'summonAdds', entry: 7, count: 2, at: 'aroundMe', attack: true, waitMs: 0 })).toBe('summon 2 × NPC 7 at its current target to attack');
    expect(d({ kind: 'summonAdds', entry: 7, count: 1, at: { x: 1, y: 2, z: 3, o: 0 }, attack: false, waitMs: 0 })).toBe('summon 1 × NPC 7 at a point');
    expect(d({ kind: 'despawnAdds', entry: 0, waitMs: 0 })).toBe('despawn its adds');
    expect(d({ kind: 'despawnAdds', entry: 7, waitMs: 0 })).toBe('despawn its adds of NPC 7');
    expect(d({ kind: 'goToPhase', phase: 2, waitMs: 0 })).toBe('go to phase 2: Air');
    expect(d({ kind: 'flee', waitMs: 0 })).toBe('flee for help');
    expect(d({ kind: 'callForHelp', radius: 20, waitMs: 0 })).toBe('call for help within 20 yd');
    expect(d({ kind: 'holdAtHealth', pct: 20, waitMs: 0 })).toBe('stop taking damage at 20% health');
    expect(d({ kind: 'surrender', waitMs: 0 })).toBe('stop fighting and turn friendly');
  });

  it('describes reactions and whole fights, including the rows added automatically', () => {
    const fight: Fight = {
      phases: ['Ground', 'Air'],
      abilities: [{ ...a, phases: [1] }],
      reactions: [
        { id: 'r1', when: { kind: 'healthBelow', pct: 50 }, phases: [1], steps: [{ kind: 'say', text: 'Enough!', style: 'yell', waitMs: 0 }, { kind: 'goToPhase', phase: 2, waitMs: 1000 }, { kind: 'summonAdds', entry: 7, count: 1, at: 'aroundMe', attack: true, waitMs: 0 }] },
        { id: 'r2', when: { kind: 'healthBelow', pct: 10 }, phases: [], steps: [{ kind: 'surrender', waitMs: 0 }] },
        { id: 'r3', when: { kind: 'kill' }, phases: [], steps: [] },
      ],
    };
    expect(describeReaction(fight.reactions[0]!, fight)).toBe('At 50% health (in Ground): yell "Enough!", then go to phase 2: Air, then summon 1 × NPC 7 at its current target to attack');
    expect(describeReaction(fight.reactions[2]!, fight)).toBe('When it kills a player: nothing yet');
    expect(AUTO_LINES.phaseStart(fight)).toBe('When it enters combat: go to phase 1: Ground (added automatically)');
    expect(AUTO_LINES.cleanup).toBe('When it resets: despawn its adds (added automatically)');
    expect(AUTO_LINES.restore).toBe('Out of combat: turns hostile again within two minutes of surrendering (added automatically)');
    expect(describeFight(fight, names)).toEqual([
      'Casts Frostbolt on its current target every 8–12 s (first after 2–4 s) (in Ground)',
      AUTO_LINES.phaseStart(fight),
      describeReaction(fight.reactions[0]!, fight, names),
      describeReaction(fight.reactions[1]!, fight, names),
      describeReaction(fight.reactions[2]!, fight, names),
      AUTO_LINES.cleanup,
      AUTO_LINES.restore,
    ]);
    expect(describeFight(emptyFight())).toEqual([]);
  });
});

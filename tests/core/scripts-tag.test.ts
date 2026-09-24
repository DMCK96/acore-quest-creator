import { describe, expect, it } from 'vitest';
import type { QuestScene } from '../../src/core/scripts/model';
import { isOurs, questTagPrefix, sceneFromComment, sceneIdOf, sceneTag, triggerComment } from '../../src/core/scripts/tag';
import { describeScene, describeStep, describeTrigger } from '../../src/core/scripts/describe';

const scene: QuestScene = {
  id: 's2', name: '', owner: { kind: 'creature', entry: 240 },
  trigger: { kind: 'questAccepted' }, gates: [],
  steps: [{ kind: 'say', text: 'Good luck, $N.', style: 'say', waitMs: 0 }],
};

describe('scene tags', () => {
  it('tags rows by quest and scene', () => {
    expect(sceneTag(60001, 's2')).toBe('AQC q60001 s2');
    expect(questTagPrefix(60001)).toBe('AQC q60001 ');
  });
  it('never mistakes another quest whose id starts the same', () => {
    expect(isOurs('AQC q60001 s1: x', 60001)).toBe(true);
    expect(isOurs('AQC q60001 s1: x', 6000)).toBe(false);
    expect(isOurs('AQC q6000 s1: x', 60001)).toBe(false);
    expect(isOurs(null, 60001)).toBe(false);
    expect(isOurs('Stormwind Guard - On Aggro - Say', 60001)).toBe(false);
  });
  it('reads the scene id back', () => {
    expect(sceneIdOf('AQC q60001 s12: say hello', 60001)).toBe('s12');
    expect(sceneIdOf('AQC q60001 s12', 60001)).toBe('s12');
    expect(sceneIdOf('something else', 60001)).toBeNull();
  });
  it('embeds the whole scene in the trigger comment and reads it back', () => {
    const comment = triggerComment(60001, scene);
    expect(comment.startsWith('AQC q60001 s2: When the quest is accepted')).toBe(true);
    expect(comment).toContain(' #aqc=');
    expect(sceneFromComment(comment)).toEqual(scene);
  });
  it('gives up on a damaged comment rather than guessing', () => {
    expect(sceneFromComment('AQC q60001 s2: x #aqc={broken')).toBeNull();
    expect(sceneFromComment('AQC q60001 s2: no data')).toBeNull();
  });
});

describe('scene descriptions', () => {
  it('describes triggers and steps in plain words', () => {
    expect(describeTrigger({ kind: 'spellHit', spellId: 0 })).toBe('When any spell or item is used on it');
    expect(describeTrigger({ kind: 'spellHit', spellId: 8593 })).toBe('When spell 8593 is used on it');
    expect(describeStep({ kind: 'credit', objective: 2, group: true })).toBe('give the group credit for objective 2');
    expect(describeStep({ kind: 'despawn', entry: 0, range: 0 })).toBe('despawn itself');
    expect(describeScene(scene)).toBe('When the quest is accepted: say "Good luck, $N."');
  });
});

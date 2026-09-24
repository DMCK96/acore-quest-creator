import { describe, expect, it } from 'vitest';
import {
  SCRIPTS_FIELD, nextSceneId, readScenes, stepNeedsPlayer, stepOwners, triggerHasPlayer, triggerOwners, writeScenes,
  type QuestScene,
} from '../../src/core/scripts/model';

const scene = (over: Partial<QuestScene> = {}): QuestScene => ({
  id: 's1',
  name: 'Totem',
  owner: { kind: 'creature', entry: 299 },
  trigger: { kind: 'spellHit', spellId: 8593 },
  gates: [{ kind: 'quest', questId: 0, state: 'inLog', negate: false }],
  steps: [{ kind: 'credit', objective: 1, group: false, waitMs: 0 }, { kind: 'despawn', entry: 0, range: 0, waitMs: 2000 }],
  ...over,
});

describe('scene model', () => {
  it('round-trips scenes through the values key', () => {
    const values = { [SCRIPTS_FIELD]: writeScenes([scene()]) };
    expect(readScenes(values)).toEqual([scene()]);
  });
  it('reads no scenes from a quest saved before scripts existed', () => {
    expect(readScenes({})).toEqual([]);
    expect(readScenes({ [SCRIPTS_FIELD]: null })).toEqual([]);
  });
  it('drops entries that are not valid scenes instead of throwing', () => {
    const values = { [SCRIPTS_FIELD]: [scene(), { id: 's9', owner: 'nonsense' }] as never };
    expect(readScenes(values).map((s) => s.id)).toEqual(['s1']);
  });
  it('allocates scene ids that are never reused', () => {
    expect(nextSceneId([])).toBe('s1');
    expect(nextSceneId([scene({ id: 's1' }), scene({ id: 's4' })])).toBe('s5');
  });
  it('knows which owners each trigger and step supports', () => {
    expect(triggerOwners('dies')).toEqual(['creature']);
    expect(triggerOwners('questAccepted')).toEqual(['creature', 'gameobject']);
    expect(triggerOwners('enterArea')).toEqual(['areatrigger']);
    expect(triggerOwners('gossipOption')).toEqual(['creature']);
    expect(stepOwners('say')).toEqual(['creature']);
    expect(stepOwners('startEscort')).toEqual(['creature']);
    expect(stepOwners('credit')).toEqual(['creature', 'gameobject', 'areatrigger']);
    expect(stepOwners('spawnNpc')).toEqual(['creature', 'gameobject']);
  });
  it('knows which triggers carry a player and which steps need one', () => {
    expect(triggerHasPlayer({ kind: 'dies' })).toBe(true);
    expect(triggerHasPlayer({ kind: 'waypointReached', escortSceneId: 's1', point: 3 })).toBe(false);
    expect(triggerHasPlayer({ kind: 'signal', signal: 1 })).toBe(false);
    expect(triggerHasPlayer({ kind: 'summoned' })).toBe(false);
    expect(stepNeedsPlayer({ kind: 'credit', objective: 1, group: false })).toBe(true);
    expect(stepNeedsPlayer({ kind: 'say', text: 'Hi', style: 'say' })).toBe(false);
    expect(stepNeedsPlayer({ kind: 'startEscort', points: [], run: false })).toBe(true);
  });
});

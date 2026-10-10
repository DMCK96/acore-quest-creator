import { describe, expect, it } from 'vitest';
import { entitySceneTag, npcRowOwner, npcSceneFromComment, npcSceneIdOf, npcTriggerComment, sceneFromComment, triggerComment } from '../../src/core/scripts/tag';
import { blankNpcScene } from '../../src/core/scripts/npc-scenes';

const scene = { ...blankNpcScene('s2'), name: 'Hello', steps: [{ kind: 'emote' as const, emote: 1, waitMs: 0 }] };

describe('NPC scene tags', () => {
  it('tags a scene row by NPC and scene', () => {
    expect(entitySceneTag(12000001, 's2')).toBe('AQC npc12000001 s2');
  });
  it('finds the owner of a scene row, and not of a fight, patrol, quest-scene or lookalike row', () => {
    expect(npcRowOwner('AQC npc12000001 s2: When a player talks', 'scene')).toBe(12000001);
    expect(npcRowOwner('AQC npc12000001 s12', 'scene')).toBe(12000001);
    expect(npcRowOwner('AQC npc12000001 fight: x', 'scene')).toBeNull();
    expect(npcRowOwner('AQC npc12000001 sx', 'scene')).toBeNull();
    expect(npcRowOwner('AQC q60001 s2', 'scene')).toBeNull();
    expect(npcRowOwner('AQC npc12000001 s2', 'fight')).toBeNull();
  });
  it("keeps NPC 1200 from claiming NPC 12000's rows", () => {
    expect(npcSceneIdOf('AQC npc12000 s1: x', 1200)).toBeNull();
    expect(npcSceneIdOf('AQC npc1200 s1: x', 1200)).toBe('s1');
  });
  it("round-trips a scene through the trigger row's comment", () => {
    expect(npcSceneFromComment(npcTriggerComment(12000001, scene))).toEqual(scene);
  });
  it("does not mistake a quest scene's comment for an NPC scene, or the reverse", () => {
    const questScene = { id: 's1', name: '', owner: { kind: 'creature' as const, entry: 5 }, trigger: { kind: 'dies' as const }, gates: [], steps: [] };
    expect(npcSceneFromComment(triggerComment(60001, questScene))).toBeNull();
    expect(sceneFromComment(npcTriggerComment(12000001, scene))).toBeNull();
    expect(npcSceneFromComment('AQC npc1 s1: damaged #aqc={')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { NPC_SCENE_LIMIT, NPC_TRIGGER_KINDS, blankNpcScene, needsQuest, nextNpcSceneId, npcSceneSchema, scenesLocked } from '../../src/core/scripts/npc-scenes';
import { sceneSchema } from '../../src/core/scripts/model';
import { newNpc, readProjectEntities } from '../../src/core/entities/model';

describe('NPC scenes', () => {
  it('parses a scene with a quest and a gossipPicked trigger', () => {
    const scene = { id: 's1', name: 'Thanks', questId: 60001, trigger: { kind: 'gossipPicked', menuId: 5, optionId: 0 }, gates: [], steps: [{ kind: 'say', text: 'Hi', style: 'say', waitMs: 0 }] };
    expect(npcSceneSchema.parse(scene)).toEqual(scene);
  });
  it('rejects a negative quest id and a scene with an owner it does not have', () => {
    expect(npcSceneSchema.safeParse({ ...blankNpcScene('s1'), questId: -1 }).success).toBe(false);
    expect(sceneSchema.safeParse(blankNpcScene('s1')).success).toBe(false);
  });
  it('lists no area trigger among the triggers an NPC can have', () => {
    expect(NPC_TRIGGER_KINDS).not.toContain('enterArea');
    expect(NPC_TRIGGER_KINDS).toContain('gossipPicked');
    expect(NPC_SCENE_LIMIT).toBe(32);
  });
  it('needs a quest for a quest trigger, a quest step, or a "this quest" gate, and not otherwise', () => {
    const base = blankNpcScene('s1');
    expect(needsQuest(base)).toBe(false);
    expect(needsQuest({ ...base, trigger: { kind: 'questHandedIn' } })).toBe(true);
    expect(needsQuest({ ...base, steps: [{ kind: 'failQuest', waitMs: 0 }] })).toBe(true);
    expect(needsQuest({ ...base, gates: [{ kind: 'quest', questId: 0, state: 'handedIn', negate: false }] })).toBe(true);
    expect(needsQuest({ ...base, gates: [{ kind: 'quest', questId: 7, state: 'handedIn', negate: false }] })).toBe(false);
  });
  it('hands out the next id past the highest in use, never a lower freed one', () => {
    expect(nextNpcSceneId([])).toBe('s1');
    expect(nextNpcSceneId([{ id: 's1' }, { id: 's4' }])).toBe('s5');
  });
  it('locks an NPC that runs another AI or a C++ script, and not one that has none or SmartAI', () => {
    expect(scenesLocked(undefined)).toBe(false);
    expect(scenesLocked({ AIName: '', ScriptName: '' })).toBe(false);
    expect(scenesLocked({ AIName: 'SmartAI', ScriptName: '' })).toBe(false);
    expect(scenesLocked({ AIName: 'NullCreatureAI', ScriptName: '' })).toBe(true);
    expect(scenesLocked({ AIName: '', ScriptName: 'boss_x' })).toBe(true);
  });
  it('gives a new NPC no scenes and loads an old NPC saved without the key', () => {
    expect(newNpc(12000001).scenes).toEqual([]);
    const { scenes: _drop, ...old } = newNpc(12000001);
    expect(readProjectEntities({ npcs: [old], objects: [], items: [] }).npcs[0]!.scenes).toEqual([]);
  });
});

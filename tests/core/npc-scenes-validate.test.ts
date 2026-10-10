import { describe, expect, it } from 'vitest';
import { npcSceneIssues } from '../../src/core/scripts/npc-validate';
import { blankNpcScene, type NpcScene } from '../../src/core/scripts/npc-scenes';
import { newNpc, type GossipMenu } from '../../src/core/entities/model';

const say = { kind: 'say' as const, text: 'Hi', style: 'say' as const, waitMs: 0 };
const scene = (id: string, over: Partial<NpcScene> = {}): NpcScene => ({ ...blankNpcScene(id), steps: [say], ...over });
const menu = (over: Partial<GossipMenu> = {}): GossipMenu => ({
  menuId: 5, textId: 9, locked: false, greeting: [{ text: 'x', textFemale: '', probability: 1 }],
  options: [{ optionId: 0, icon: 0, text: 'Bye', action: { kind: 'close' }, kept: false }], ...over,
});
const run = (scenes: NpcScene[], opts: { tree?: GossipMenu[] | null; known?: number[]; locked?: boolean } = {}) =>
  npcSceneIssues({
    npc: { ...newNpc(12000001), scenes, gossipMenu: opts.tree ? { menus: opts.tree } : null },
    label: 'NPC "Hela"', knownQuest: (id) => (opts.known ?? []).includes(id), locked: opts.locked ?? false,
  }).map((i) => `${i.severity}:${i.code}`);
const picked = (menuId = 5, optionId = 0) => scene('s1', { trigger: { kind: 'gossipPicked', menuId, optionId } });

describe('NPC scene checks', () => {
  it('is quiet for a plain scene, and for an NPC with none', () => {
    expect(run([scene('s1')])).toEqual([]);
    expect(run([])).toEqual([]);
  });
  it('needs a quest for a quest trigger, and warns about a quest nobody knows', () => {
    expect(run([scene('s1', { trigger: { kind: 'questHandedIn' } })])).toContain('error:NPC_SCENE_QUEST_NEEDED');
    expect(run([scene('s1', { questId: 7 })], { known: [7] })).toEqual([]);
    expect(run([scene('s1', { questId: 7 })])).toEqual(['warning:NPC_SCENE_QUEST_UNKNOWN']);
  });
  it("flags a gossipPicked option that is gone, locked, kept, or not this NPC's menu", () => {
    expect(run([picked()], { tree: [menu()] })).toEqual([]);
    expect(run([picked(5, 3)], { tree: [menu()] })).toEqual(['error:NPC_SCENE_OPTION_GONE']);
    expect(run([picked()], { tree: null })).toEqual(['error:NPC_SCENE_OPTION_GONE']);
    expect(run([picked(5, 0)], { tree: [menu({ locked: true })] })).toEqual(['error:NPC_SCENE_OPTION_LOCKED']);
    expect(run([picked(5, 0)], { tree: [menu({ options: [{ optionId: 0, icon: 0, text: 'B', action: { kind: 'close' }, kept: true }] })] })).toEqual(['error:NPC_SCENE_OPTION_LOCKED']);
    expect(run([picked(77, 0)], { tree: [menu()] })).toEqual(['error:NPC_SCENE_OPTION_LOCKED']);
  });
  it('flags an escort wait that names no escort of this NPC', () => {
    const wait = scene('s2', { trigger: { kind: 'waypointReached', escortSceneId: 's1', point: 1 } });
    expect(run([scene('s1'), wait])).toContain('error:NPC_SCENE_ESCORT');
    const escort = scene('s1', { steps: [{ kind: 'startEscort', points: [{ x: 0, y: 0, z: 0, o: 0 }], run: false, waitMs: 0 }] });
    expect(run([escort, wait])).not.toContain('error:NPC_SCENE_ESCORT');
  });
  it('flags duplicate ids, too many scenes, and a scene with nothing to do', () => {
    expect(run([scene('s1'), scene('s1')])).toContain('error:NPC_SCENE_ID_DUPLICATE');
    expect(run(Array.from({ length: 33 }, (_, i) => scene(`s${i + 1}`)))).toContain('error:NPC_SCENE_LIMIT');
    expect(run([scene('s1', { steps: [] })])).toEqual(['warning:NPC_SCENE_NO_STEPS']);
  });
  it("says a locked NPC's scenes are not written, and nothing else about them", () => {
    expect(run([scene('s1', { trigger: { kind: 'questHandedIn' } })], { locked: true })).toEqual(['warning:NPC_SCENES_LOCKED']);
    expect(run([], { locked: true })).toEqual([]);
  });
  it('keeps the checks quest scenes have: a player step on a trigger with no player', () => {
    expect(run([scene('s1', { trigger: { kind: 'summoned' }, steps: [{ kind: 'castOnPlayer', spellId: 5, waitMs: 0 }] })])).toContain('error:SCENE_NO_PLAYER');
  });
});

import { describe, expect, it } from 'vitest';
import { compileNpcScenes } from '../../src/core/scripts/npc-compile';
import { EMPTY_SCRIPT_CONTEXT } from '../../src/core/scripts/context';
import { blankNpcScene, type NpcScene } from '../../src/core/scripts/npc-scenes';
import { newNpc } from '../../src/core/entities/model';
import { npcTriggerComment } from '../../src/core/scripts/tag';
import { EVENT } from '../../src/core/smartai/ids';

const NONE = { inserts: {}, deletes: {}, updates: [], flags: [], warnings: [] };
const say = (text: string) => ({ kind: 'say' as const, text, style: 'say' as const, waitMs: 0 });
const scene = (id: string, over: Partial<NpcScene> = {}): NpcScene => ({ ...blankNpcScene(id), steps: [say('Hi')], ...over });
const npcWith = (scenes: NpcScene[], entry = 12000001) => ({ ...newNpc(entry), name: 'Hela', scenes });
const compile = (npcs: ReturnType<typeof npcWith>[], context = EMPTY_SCRIPT_CONTEXT, extra = {}) =>
  compileNpcScenes({ npcs, objectives: new Map(), context, taken: NONE, ...extra });
const smart = (out: ReturnType<typeof compile>) => out.inserts.smart_scripts ?? [];

describe('compiling NPC scenes', () => {
  it('writes a talked-to scene tagged for the NPC, with the scene as data on the trigger row', () => {
    const rows = smart(compile([npcWith([scene('s1')])]));
    expect(rows.every((r) => r.comment!.startsWith('AQC npc12000001 s1'))).toBe(true);
    expect(rows.filter((r) => r.comment!.includes(' #aqc=')).length).toBe(1);
    expect(rows[0]).toMatchObject({ entryorguid: '12000001', source_type: '0', event_type: String(EVENT.gossipHello) });
  });

  it.each([
    ['dies', { kind: 'dies' as const }],
    ['spellHit', { kind: 'spellHit' as const, spellId: 100 }],
    ['playerNear', { kind: 'playerNear' as const, range: 8 }],
    ['signal', { kind: 'signal' as const, signal: 3 }],
    ['summoned', { kind: 'summoned' as const }],
    ['talkedTo', { kind: 'talkedTo' as const }],
  ])('compiles a %s scene to rows on the NPC', (_name, trigger) => {
    const rows = smart(compile([npcWith([scene('s1', { trigger })])]));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.entryorguid === '12000001' || r.source_type === '9')).toBe(true);
  });

  it('writes a gossipPicked scene as an event 62 row naming the menu and option, and no gossip rows', () => {
    const out = compile([npcWith([scene('s1', { trigger: { kind: 'gossipPicked', menuId: 55, optionId: 2 } })])]);
    const trigger = smart(out).find((r) => r.event_type === '62')!;
    expect(trigger).toMatchObject({ event_param1: '55', event_param2: '2', source_type: '0' });
    expect(out.inserts.gossip_menu).toBeUndefined();
    expect(out.inserts.gossip_menu_option).toBeUndefined();
    expect(out.inserts.npc_text).toBeUndefined();
  });

  it('uses the scene\'s quest for quest triggers, objective credit and "this quest" gates', () => {
    const quest = scene('s1', {
      questId: 60002, trigger: { kind: 'questHandedIn' },
      gates: [{ kind: 'quest', questId: 0, state: 'handedIn', negate: false }],
      steps: [{ kind: 'credit', objective: 1, group: false, waitMs: 0 }],
    });
    const out = compile([npcWith([quest])], EMPTY_SCRIPT_CONTEXT, { objectives: new Map([[60002, [1423, 0, 0, 0]]]) });
    expect(smart(out).some((r) => r.event_param1 === '60002')).toBe(true);
    expect(smart(out).some((r) => r.action_param1 === '1423')).toBe(true);
    expect(out.inserts.conditions![0]).toMatchObject({ ConditionValue1: '60002' });
  });

  it('skips a scene that needs a quest and has none, with a warning', () => {
    const out = compile([npcWith([scene('s1', { trigger: { kind: 'questAccepted' } })])]);
    expect(smart(out)).toEqual([]);
    expect(out.warnings).toEqual(['NPC 12000001 scene s1 needs a quest, so it was not written.']);
  });

  it('still compiles a scene whose quest is not in the project', () => {
    const out = compile([npcWith([scene('s1', { questId: 99999, trigger: { kind: 'questAccepted' } })])]);
    expect(smart(out).some((r) => r.event_param1 === '99999')).toBe(true);
    expect(out.warnings).toEqual([]);
  });

  it('sets SmartAI only where the AI is empty, and not at all for the last scene removed', () => {
    const withAi = (AIName: string) => ({ ...EMPTY_SCRIPT_CONTEXT, creatures: [{ entry: '12000001', npcflag: '0', gossip_menu_id: '0', AIName, ScriptName: '' }] });
    expect(compile([npcWith([scene('s1')])], withAi('')).updates).toEqual([{ table: 'creature_template', key: { entry: '12000001' }, set: { AIName: 'SmartAI' }, onlyIf: { AIName: '' } }]);
    expect(compile([npcWith([scene('s1')])], withAi('SmartAI')).updates).toEqual([]);
    expect(compile([npcWith([])], withAi('')).updates).toEqual([]);
  });

  it('writes nothing for an NPC that runs another AI or a C++ script, nor deletes anything', () => {
    const own = { entryorguid: '12000001', source_type: '0', id: '0', link: '0', event_type: '4', comment: 'AQC npc12000001 s1: old' };
    for (const row of [{ AIName: 'NullCreatureAI', ScriptName: '' }, { AIName: '', ScriptName: 'boss_x' }]) {
      const context = { ...EMPTY_SCRIPT_CONTEXT, smartScripts: [own], creatures: [{ entry: '12000001', npcflag: '0', gossip_menu_id: '0', ...row }] };
      const out = compile([npcWith([scene('s1')])], context);
      expect(out.inserts).toEqual({});
      expect(out.deletes).toEqual({});
      expect(out.updates).toEqual([]);
    }
  });

  it('writes nothing for an NPC whose origin locks its scenes', () => {
    const npc = { ...npcWith([scene('s1')]), origin: { kind: 'existing' as const, original: {}, sharedLoot: 0, spawnCount: 1, locked: ['scenes' as const] } };
    expect(smart(compile([npc]))).toEqual([]);
  });

  it("takes ids clear of the database's rows and a linked chain on an NPC with hundreds of them", () => {
    const database = Array.from({ length: 300 }, (_, i) => ({ entryorguid: '12000001', source_type: '0', id: String(i), link: i % 2 === 0 ? String(i + 1) : '0', event_type: i % 2 === 0 ? '1' : '61', comment: '' }));
    const rows = smart(compile([npcWith([scene('s1'), scene('s2', { trigger: { kind: 'dies' } })])], { ...EMPTY_SCRIPT_CONTEXT, smartScripts: database }));
    const mine = rows.filter((r) => r.source_type === '0').map((r) => Number(r.id));
    expect(mine.every((id) => id >= 300)).toBe(true);
    expect(new Set(mine).size).toBe(mine.length);
  });

  it("deletes only its own tagged rows, never a database row or a fight's", () => {
    const context = { ...EMPTY_SCRIPT_CONTEXT, smartScripts: [
      { entryorguid: '12000001', source_type: '0', id: '0', link: '0', event_type: '1', comment: '' },
      { entryorguid: '12000001', source_type: '0', id: '1', link: '0', event_type: '4', comment: 'AQC npc12000001 fight: x' },
      { entryorguid: '12000001', source_type: '0', id: '2', link: '0', event_type: '1', comment: npcTriggerComment(12000001, scene('s1')) },
    ] };
    const out = compile([npcWith([])], context);
    expect(out.deletes.smart_scripts).toEqual([{ entryorguid: '12000001', source_type: '0', id: '2', link: '0' }]);
  });

  it("leaves the tree's option alone when it deletes the row of a gossipPicked scene, and deletes the option a gossipOption scene added", () => {
    const row = (trigger: NpcScene['trigger']) => ({ entryorguid: '12000001', source_type: '0', id: '0', link: '0', event_type: '62', event_param1: '55', event_param2: '2', comment: npcTriggerComment(12000001, scene('s1', { trigger })) });
    const picked = compile([npcWith([])], { ...EMPTY_SCRIPT_CONTEXT, smartScripts: [row({ kind: 'gossipPicked', menuId: 55, optionId: 2 })] });
    expect(picked.deletes.gossip_menu_option).toBeUndefined();
    const added = compile([npcWith([])], { ...EMPTY_SCRIPT_CONTEXT, smartScripts: [row({ kind: 'gossipOption', text: 'Hi', greeting: '' })] });
    expect(added.deletes.gossip_menu_option).toEqual([{ MenuID: '55', OptionID: '2' }]);
  });

  it('gives two scenes with the same trigger separate rows in list order', () => {
    const rows = smart(compile([npcWith([scene('s1', { steps: [say('first')] }), scene('s2', { steps: [say('second')] })])]));
    const ids = rows.filter((r) => r.comment!.includes(' #aqc=')).map((r) => [r.comment!.slice(0, 18), Number(r.id)] as const);
    expect(ids.map(([tag]) => tag)).toEqual(['AQC npc12000001 s1', 'AQC npc12000001 s2']);
    expect(ids[0]![1]).toBeLessThan(ids[1]![1]);
  });

  it("keeps an escort's path id clear of the database's and of the rows already taken", () => {
    const escort = scene('s1', { steps: [{ kind: 'startEscort', points: [{ x: 1, y: 1, z: 1, o: 0 }], run: false, waitMs: 0 }] });
    const out = compile([npcWith([escort])], { ...EMPTY_SCRIPT_CONTEXT, waypointsMax: 777 });
    expect(out.inserts.waypoints![0]).toMatchObject({ entry: '778' });
    expect(out.inserts.waypoints![0]!.point_comment).toMatch(/^AQC npc12000001 s1/);
  });
});

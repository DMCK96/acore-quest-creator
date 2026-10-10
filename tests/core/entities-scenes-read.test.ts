import { describe, expect, it } from 'vitest';
import { npcFromRows } from '../../src/core/entities/from-rows';
import { blankNpcScene } from '../../src/core/scripts/npc-scenes';
import { npcTriggerComment } from '../../src/core/scripts/tag';

const creature = { entry: '100', name: 'Old', gossip_menu_id: '5', npcflag: '1', AIName: 'SmartAI', ScriptName: '' };
const rows = (scripts: Record<string, string>[]) => ({
  creature_template: [creature],
  gossip_menu: [{ MenuID: '5', TextID: '9' }],
  gossip_menu_option: [{ MenuID: '5', OptionID: '0', OptionIcon: '0', OptionText: 'Hi', OptionType: '1', OptionNpcFlag: '1', ActionMenuID: '0' }],
  npc_text: [{ ID: '9', text0_0: 'Hello', Probability0: '1' }],
  smart_scripts: scripts,
});
const select = (comment: string) => ({ entryorguid: '100', source_type: '0', id: '0', link: '0', event_type: '62', event_param1: '5', event_param2: '0', comment });
const optionOf = (npc: ReturnType<typeof npcFromRows>) => npc.gossipMenu!.menus[0]!.options[0]!;
const counts = { sharedLoot: 0, spawnCount: 1 };

describe('existing NPCs and scenes', () => {
  it('does not freeze an option because one of our own scenes hangs off it', () => {
    expect(optionOf(npcFromRows(100, rows([select(npcTriggerComment(100, { ...blankNpcScene('s1'), trigger: { kind: 'gossipPicked', menuId: 5, optionId: 0 } }))]), counts)).kept).toBe(false);
  });
  it('still freezes an option a database script, or another tag, names', () => {
    expect(optionOf(npcFromRows(100, rows([select('')]), counts)).kept).toBe(true);
    expect(optionOf(npcFromRows(100, rows([select('AQC npc100 fight: x')]), counts)).kept).toBe(true);
    expect(optionOf(npcFromRows(100, rows([select('AQC npc1000 s1: x')]), counts)).kept).toBe(true);
  });
  it('records how many scripts the database runs and locks the scenes of an NPC that runs something else', () => {
    const npc = npcFromRows(100, { ...rows([]), creature_template: [{ ...creature, AIName: 'ReactorAI' }] }, { ...counts, databaseScripts: 4 });
    expect(npc.origin).toMatchObject({ kind: 'existing', databaseScripts: 4 });
    expect((npc.origin as { locked: string[] }).locked).toContain('scenes');
    expect(npcFromRows(100, rows([]), counts).scenes).toEqual([]);
  });
  it('locks the scenes of an NPC whose template runs another AI or a script, and not one that runs SmartAI', () => {
    const lockedOf = (c: Record<string, string>) => (npcFromRows(100, { ...rows([]), creature_template: [{ ...creature, ...c }] }, counts).origin as { locked: string[] }).locked;
    expect(lockedOf({ AIName: 'ReactorAI' })).toContain('scenes');
    expect(lockedOf({ AIName: '', ScriptName: 'boss_x' })).toContain('scenes');
    expect(lockedOf({ AIName: 'SmartAI' })).not.toContain('scenes');
    expect(lockedOf({ AIName: '' })).not.toContain('scenes');
  });
  it('starts a put-back NPC with no scenes even when the counts carry some', () => {
    expect(npcFromRows(100, rows([]), { ...counts, scenes: [blankNpcScene('s1')] }).scenes).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { compileFights } from '../../src/core/combat/compile';
import { emptyFight, newAbility, type Ability, type Fight, type FightStep, type Reaction, type ReactionWhen } from '../../src/core/combat/model';
import { compileEntities } from '../../src/core/entities/compile';
import { EMPTY_ENTITY_CONTEXT } from '../../src/core/entities/context';
import { newNpc, type CustomNpc } from '../../src/core/entities/model';
import type { CompiledScripts } from '../../src/core/scripts/compile';
import { EMPTY_SCRIPT_CONTEXT, type ScriptContext } from '../../src/core/scripts/context';

const Q = 60001;
const E = 12000001;
const TAG = 'AQC q60001 fight12000001';
const none = (): CompiledScripts => ({ inserts: {}, deletes: {}, updates: [], flags: [], warnings: [] });
const fight = (over: Partial<Fight> = {}): Fight => ({ ...emptyFight(), ...over });
const ability = (over: Partial<Ability> = {}): Ability => ({ ...newAbility(emptyFight()), id: 'a1', spellId: 116, ...over });
const reaction = (when: ReactionWhen, steps: FightStep[], over: Partial<Reaction> = {}): Reaction => ({ id: 'r1', when, phases: [], steps, ...over });
const npc = (f: Fight | null, entry = E): CustomNpc => ({ ...newNpc(entry), name: 'Hela', displayId: 1, fight: f });
const compile = (npcs: CustomNpc[], context: ScriptContext = EMPTY_SCRIPT_CONTEXT, taken = none()) =>
  compileFights({ questId: Q, npcs, objectives: [E, 0, 0, 0], context, taken });
const smart = (out: CompiledScripts) => out.inserts.smart_scripts ?? [];
const yell = (text: string, waitMs = 0): FightStep => ({ kind: 'say', text, style: 'yell', waitMs });

describe('compileFights: abilities', () => {
  it('writes a timed cast on the NPC', () => {
    const out = compile([npc(fight({ abilities: [ability()] }))]);
    expect(smart(out)).toEqual([expect.objectContaining({
      entryorguid: '12000001', source_type: '0', id: '0', link: '0', event_type: '0', event_phase_mask: '0', event_flags: '0',
      event_param1: '2000', event_param2: '4000', event_param3: '8000', event_param4: '12000',
      action_type: '11', action_param1: '116', action_param2: '0', target_type: '2',
      comment: `${TAG}: Casts spell 116 on its current target every 8–12 s (first after 2–4 s)`,
    })]);
  });

  it('maps targets, cast flags and once-only abilities', () => {
    const out = compile([npc(fight({ abilities: [
      ability({ id: 'a1', target: 'self', keepDistance: true }),
      ability({ id: 'a2', target: 'random', skipIfAuraPresent: true }),
      ability({ id: 'a3', target: 'randomNotTank', keepDistance: true, skipIfAuraPresent: true }),
      ability({ id: 'a4', target: 'secondThreat', repeatMinS: 0, repeatMaxS: 0 }),
    ] }))]);
    expect(smart(out).map((r) => [r.target_type, r.action_param2, r.event_flags, r.event_param3, r.event_param4])).toEqual([
      ['1', '1088', '0', '8000', '12000'],
      ['5', '32', '0', '8000', '12000'],
      ['6', '1120', '0', '8000', '12000'],
      ['3', '0', '1', '0', '0'],
    ]);
  });
});

describe('compileFights: reactions', () => {
  it('puts a single yell on the health row, with its text', () => {
    const out = compile([npc(fight({ reactions: [reaction({ kind: 'healthBelow', pct: 30 }, [yell('Enough!')])] }))]);
    expect(out.inserts.creature_text).toEqual([expect.objectContaining({
      CreatureID: '12000001', GroupID: '0', ID: '0', Text: 'Enough!', Type: '14', comment: `${TAG}: yell "Enough!"`,
    })]);
    expect(smart(out)).toEqual([expect.objectContaining({
      id: '0', event_type: '2', event_param1: '0', event_param2: '30', event_flags: '1',
      action_type: '1', action_param1: '0', action_param3: '0', target_type: '1',
      comment: `${TAG}: At 30% health: yell "Enough!"`,
    })]);
  });

  it('runs several steps through a timed list', () => {
    const out = compile([npc(fight({ reactions: [reaction({ kind: 'aggro' }, [yell('Die!'), { kind: 'cast', spellId: 8269, target: 'self', waitMs: 2000 }])] }))]);
    const rows = smart(out);
    expect(rows[0]).toMatchObject({ source_type: '0', event_type: '4', action_type: '80', action_param1: '1200000100', action_param2: '2', action_param3: '1' });
    expect(rows.slice(1).map((r) => [r.entryorguid, r.source_type, r.id, r.event_param1, r.action_type, r.action_param1, r.target_type])).toEqual([
      ['1200000100', '9', '0', '0', '1', '0', '7'],
      ['1200000100', '9', '1', '2000', '11', '8269', '1'],
    ]);
  });

  it('chains death steps with links, because a dead NPC runs no lists', () => {
    const out = compile([npc(fight({ reactions: [reaction({ kind: 'death' }, [yell('No...'), { kind: 'credit', objective: 1, group: false, waitMs: 500 }])] }))]);
    expect(smart(out).map((r) => [r.source_type, r.id, r.link, r.event_type, r.action_type, r.action_param1, r.target_type])).toEqual([
      ['0', '0', '1', '6', '1', '0', '7'],
      ['0', '1', '0', '61', '33', '12000001', '1'],
    ]);
  });

  it('maps every trigger to its event', () => {
    const whens: ReactionWhen[] = [
      { kind: 'friendHealthBelow', pct: 40, range: 30 }, { kind: 'addDies', entry: 7 }, { kind: 'kill' }, { kind: 'evade' },
    ];
    const out = compile([npc(fight({ reactions: whens.map((w, i) => reaction(w, [{ kind: 'flee', waitMs: 0 }], { id: `r${i + 1}` })) }))]);
    expect(smart(out).map((r) => [r.event_type, r.event_param1, r.event_param2, r.event_param3, r.event_param4, r.event_param5, r.event_param6])).toEqual([
      ['74', '1000', '3000', '10000', '15000', '40', '30'],
      ['82', '7', '0', '0', '0', '0', '0'],
      ['5', '0', '0', '1', '0', '0', '0'],
      ['7', '0', '0', '0', '0', '0', '0'],
    ]);
    expect(smart(out).every((r) => r.action_type === '25' && r.action_param1 === '1')).toBe(true);
  });

  it('heals the hurt friend through the invoker', () => {
    const out = compile([npc(fight({ reactions: [reaction({ kind: 'friendHealthBelow', pct: 40, range: 30 }, [{ kind: 'cast', spellId: 2054, target: 'hurtFriend', waitMs: 0 }])] }))]);
    expect(smart(out)[0]).toMatchObject({ action_type: '11', action_param1: '2054', target_type: '7' });
  });

  it('maps the combat steps to their actions', () => {
    const steps: FightStep[] = [
      { kind: 'goToPhase', phase: 1, waitMs: 0 }, { kind: 'callForHelp', radius: 20, waitMs: 0 }, { kind: 'holdAtHealth', pct: 20, waitMs: 0 },
      { kind: 'emote', emote: 5, waitMs: 0 }, { kind: 'summonAdds', entry: 7, count: 1, at: { x: 1, y: 2, z: 3, o: 4 }, attack: false, waitMs: 0 },
    ];
    const out = compile([npc(fight({ phases: ['A'], reactions: steps.map((s, i) => reaction({ kind: 'healthBelow', pct: 90 - i }, [s], { id: `r${i + 1}` })) }))]);
    const rows = smart(out).filter((r) => r.event_type === '2');
    expect(rows.map((r) => [r.action_type, r.action_param1, r.action_param2, r.action_param3, r.action_param4, r.target_type])).toEqual([
      ['22', '1', '0', '0', '0', '1'],
      ['39', '20', '1', '0', '0', '1'],
      ['42', '0', '20', '0', '0', '1'],
      ['5', '5', '0', '0', '0', '1'],
      ['12', '7', '6', '10000', '0', '8'],
    ]);
    expect(rows[4]).toMatchObject({ target_x: '1', target_y: '2', target_z: '3', target_o: '4' });
  });
});

describe('compileFights: adds and surrender', () => {
  it('summons one row per add and despawns them on reset automatically', () => {
    const out = compile([npc(fight({ reactions: [reaction({ kind: 'healthBelow', pct: 50 }, [{ kind: 'summonAdds', entry: 12000002, count: 2, at: 'aroundMe', attack: true, waitMs: 0 }])] }))]);
    const list = smart(out).filter((r) => r.source_type === '9');
    expect(list.map((r) => [r.action_type, r.action_param1, r.action_param2, r.action_param3, r.action_param4, r.target_type])).toEqual([
      ['12', '12000002', '6', '10000', '1', '2'],
      ['12', '12000002', '6', '10000', '1', '2'],
    ]);
    // I5: only this NPC's own summons (SMART_TARGET_SUMMONED_CREATURES), never every creature of the entry.
    const evade = smart(out).find((r) => r.event_type === '7')!;
    expect(evade).toMatchObject({ action_type: '41', target_type: '204', target_param1: '0', comment: `${TAG}: When it resets: despawn its adds (added automatically)` });
  });

  it('despawns only its own adds, never every creature of an entry in range', () => {
    const out = compile([npc(fight({ reactions: [
      reaction({ kind: 'healthBelow', pct: 50 }, [{ kind: 'summonAdds', entry: 7, count: 1, at: 'aroundMe', attack: false, waitMs: 0 }]),
      reaction({ kind: 'evade' }, [{ kind: 'despawnAdds', entry: 0, waitMs: 0 }], { id: 'r2' }),
      reaction({ kind: 'death' }, [{ kind: 'despawnAdds', entry: 7, waitMs: 0 }], { id: 'r3' }),
    ] }))]);
    const despawns = smart(out).filter((r) => r.action_type === '41');
    expect(despawns.map((r) => [r.event_type, r.target_type, r.target_param1])).toEqual([['7', '204', '0'], ['6', '204', '7']]);
    expect(smart(out).some((r) => r.target_type === '9')).toBe(false);
    expect(smart(out).filter((r) => r.event_type === '7')).toHaveLength(1);
  });

  it('summons adds that do not attack where it stands', () => {
    const out = compile([npc(fight({ reactions: [reaction({ kind: 'healthBelow', pct: 50 }, [{ kind: 'summonAdds', entry: 7, count: 1, at: 'aroundMe', attack: false, waitMs: 0 }])] }))]);
    expect(smart(out).find((r) => r.action_type === '12')).toMatchObject({ action_param4: '0', target_type: '1' });
  });

  it('surrenders by turning friendly and resetting, and turns hostile again out of combat', () => {
    const out = compile([npc(fight({ reactions: [reaction({ kind: 'healthBelow', pct: 20 }, [{ kind: 'surrender', waitMs: 0 }])] }))]);
    const list = smart(out).filter((r) => r.source_type === '9');
    expect(list.map((r) => [r.action_type, r.action_param1, r.target_type])).toEqual([['2', '35', '1'], ['24', '0', '1']]);
    expect(smart(out).find((r) => r.event_type === '1')).toMatchObject({
      event_param1: '120000', event_param2: '120000', event_param3: '120000', event_param4: '120000', action_type: '2', action_param1: '0', target_type: '1',
      comment: `${TAG}: Out of combat: turns hostile again within two minutes of surrendering (added automatically)`,
    });
  });
});

describe('compileFights: server rules', () => {
  it('runs a friend-is-hurt reaction through a list unless its one action is on itself or the friend', () => {
    const on = (target: 'victim' | 'hurtFriend') => compile([npc(fight({ reactions: [reaction({ kind: 'friendHealthBelow', pct: 40, range: 30 }, [{ kind: 'cast', spellId: 2054, target, waitMs: 0 }])] }))]);
    expect(smart(on('victim'))[0]).toMatchObject({ event_type: '74', action_type: '80' });
    expect(smart(on('hurtFriend'))[0]).toMatchObject({ event_type: '74', action_type: '11', target_type: '7' });
  });

  it('keeps a long line\'s text comment within the 255 characters the column holds', () => {
    const long = 'A'.repeat(400);
    const out = compile([npc(fight({ reactions: [reaction({ kind: 'aggro' }, [yell(long)])] }))]);
    const row = out.inserts.creature_text![0]!;
    expect(row.Text).toBe(long);
    expect(row.comment!.length).toBeLessThanOrEqual(255);
    expect(row.comment!.startsWith(`${TAG}: yell "AAA`)).toBe(true);
  });
});

describe('compileFights: phases', () => {
  it('masks rows by phase and enters phase 1 on aggro', () => {
    const out = compile([npc(fight({
      phases: ['Ground', 'Air'],
      abilities: [ability({ id: 'a1', phases: [1] }), ability({ id: 'a2', phases: [2] }), ability({ id: 'a3' })],
      reactions: [reaction({ kind: 'healthBelow', pct: 50 }, [{ kind: 'goToPhase', phase: 2, waitMs: 0 }], { phases: [1] }), reaction({ kind: 'death' }, [yell('x')], { id: 'r2', phases: [2] })],
    }))]);
    expect(smart(out).map((r) => [r.id, r.event_type, r.event_phase_mask, r.action_type, r.action_param1])).toEqual([
      ['0', '0', '1', '11', '116'],
      ['1', '0', '2', '11', '116'],
      ['2', '0', '0', '11', '116'],
      ['3', '4', '0', '22', '1'],
      ['4', '2', '1', '22', '2'],
      ['5', '6', '0', '1', '0'],
    ]);
    expect(smart(out)[3]!.comment).toBe(`${TAG}: When it enters combat: go to phase 1: Ground (added automatically)`);
  });
});

describe('compileFights: sharing the NPC', () => {
  it('allocates around foreign rows and the scene rows compiled just before', () => {
    const context: ScriptContext = {
      ...EMPTY_SCRIPT_CONTEXT,
      smartScripts: [
        { entryorguid: String(E), source_type: '0', id: '0', link: '0', comment: 'hand written' },
        { entryorguid: '1200000100', source_type: '9', id: '0', link: '0', comment: 'hand written' },
      ],
      creatureText: [{ CreatureID: String(E), GroupID: '0', ID: '0', comment: 'hand written' }],
    };
    const taken: CompiledScripts = { ...none(), inserts: {
      smart_scripts: [{ entryorguid: String(E), source_type: '0', id: '1', link: '0' }, { entryorguid: '1200000101', source_type: '9', id: '0', link: '0' }],
      creature_text: [{ CreatureID: String(E), GroupID: '1', ID: '0' }],
    } };
    const out = compile([npc(fight({ abilities: [ability()], reactions: [reaction({ kind: 'aggro' }, [yell('Die!'), { kind: 'flee', waitMs: 1000 }])] }))], context, taken);
    expect(smart(out).filter((r) => r.source_type === '0').map((r) => r.id)).toEqual(['2', '3']);
    expect(smart(out)[1]).toMatchObject({ action_param1: '1200000102' });
    expect(out.inserts.creature_text![0]).toMatchObject({ GroupID: '2' });
  });

  it('deletes its old rows for NPCs still in the project, and only those', () => {
    const context: ScriptContext = {
      ...EMPTY_SCRIPT_CONTEXT,
      smartScripts: [
        { entryorguid: String(E), source_type: '0', id: '4', link: '0', comment: `${TAG}: old` },
        { entryorguid: '1200000100', source_type: '9', id: '0', link: '0', comment: `${TAG}: old` },
        { entryorguid: '12000009', source_type: '0', id: '0', link: '0', comment: 'AQC q60001 fight12000009: old' },
        { entryorguid: String(E), source_type: '0', id: '5', link: '0', comment: 'AQC q60001 s1: a scene' },
      ],
      creatureText: [{ CreatureID: String(E), GroupID: '3', ID: '0', comment: `${TAG}: yell "x"` }],
    };
    const out = compile([npc(null)], context);
    expect(out.deletes.smart_scripts).toEqual([
      { entryorguid: String(E), source_type: '0', id: '4', link: '0' },
      { entryorguid: '1200000100', source_type: '9', id: '0', link: '0' },
    ]);
    expect(out.deletes.creature_text).toEqual([{ CreatureID: String(E), GroupID: '3', ID: '0' }]);
    expect(out.inserts).toEqual({});
    const again = compile([npc(fight({ abilities: [ability()] }))], context);
    expect(smart(again)[0]).toMatchObject({ id: '0' });
  });
});

describe('compileEntities: AI for fighting NPCs', () => {
  it('sets SmartAI on a new NPC with a fight, and leaves one without alone', () => {
    const out = compileEntities({ questId: Q, entities: { npcs: [npc(fight({ abilities: [ability()] })), npc(null, 12000002)], objects: [] }, givers: [], context: EMPTY_ENTITY_CONTEXT });
    expect(out.inserts.creature_template!.map((r) => r.AIName)).toEqual(['SmartAI', '']);
  });
});

import { describe, expect, it } from 'vitest';
import { compileFights } from '../../src/core/combat/compile';
import { fightIssues } from '../../src/core/combat/validate';
import { EMPTY_SCRIPT_CONTEXT } from '../../src/core/scripts/context';
import { newNpc } from '../../src/core/entities/model';
import type { Fight } from '../../src/core/combat/model';

const EMPTY = { inserts: {}, deletes: {}, updates: [], flags: [], warnings: [] };
const creditFight = (quest: number, objective: 1 | 2 = 1): Fight =>
  ({ phases: [], abilities: [], reactions: [{ id: 'r1', when: { kind: 'death' }, phases: [], steps: [{ kind: 'credit', objective, group: false, quest, waitMs: 0 }] }] });
const credit = (quest: number, objective: 1 | 2 = 1) => ({ ...newNpc(12000001), name: 'Hela', fight: creditFight(quest, objective) });

describe('fights in the project patch', () => {
  it('tags fight rows by NPC and credits the objective of the quest the step names', () => {
    const out = compileFights({ npcs: [credit(60002)], objectives: new Map([[60002, [1423, 0, 0, 0]]]), context: EMPTY_SCRIPT_CONTEXT, taken: EMPTY });
    const rows = out.inserts.smart_scripts!;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.comment!.startsWith('AQC npc12000001 fight'))).toBe(true);
    expect(rows.some((r) => r.action_param1 === '1423')).toBe(true);
  });

  it('deletes fight rows a past export wrote under the quest tag or the NPC tag', () => {
    const context = { ...EMPTY_SCRIPT_CONTEXT, smartScripts: [
      { entryorguid: '12000001', source_type: '0', id: '7', link: '0', comment: 'AQC q60001 fight12000001: old' },
      { entryorguid: '12000001', source_type: '0', id: '8', link: '0', comment: 'AQC npc12000001 fight: older' },
      { entryorguid: '12000001', source_type: '0', id: '9', link: '0', comment: 'AQC q60001 s1: a scene' },
    ] };
    const out = compileFights({ npcs: [credit(60002)], objectives: new Map([[60002, [1423, 0, 0, 0]]]), context, taken: EMPTY });
    const deleted = out.deletes.smart_scripts!.map((k) => k.id);
    expect(deleted).toEqual(['7', '8']);
  });

  it('says when a credit names no quest, a quest not in the project, or an objective it does not have', () => {
    const messages = (quest: number, objective: 1 | 2, objectives: Map<number, number[]>) => fightIssues(creditFight(quest, objective), 'NPC "Hela"', null, objectives).map((i) => i.message);
    expect(messages(0, 1, new Map())).toEqual(['NPC "Hela": a credit step names no quest; pick the quest it gives credit for.']);
    expect(messages(60009, 1, new Map())).toEqual(['NPC "Hela": a credit step names quest 60009, which is not in the project.']);
    expect(messages(60002, 2, new Map([[60002, [1423, 0, 0, 0]]]))).toEqual(['NPC "Hela": objective 2 of quest 60002 is not an NPC objective.']);
    expect(messages(60002, 1, new Map([[60002, [1423, 0, 0, 0]]]))).toEqual([]);
  });
});

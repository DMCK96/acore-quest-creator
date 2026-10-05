import { describe, expect, it } from 'vitest';
import { EMPTY_ENTITIES, newItem, newNpc, newObject, readProjectEntities } from '../../src/core/entities/model';
import { fightSchema } from '../../src/core/combat/model';

describe('the project store model', () => {
  it('starts empty', () => {
    expect(EMPTY_ENTITIES).toEqual({ npcs: [], objects: [], items: [] });
  });

  it('makes NPCs, objects and items with no quest attached', () => {
    expect(newNpc(12000001)).not.toHaveProperty('madeFor');
    expect(newObject(9100001)).not.toHaveProperty('madeFor');
    expect(newItem(9200001)).not.toHaveProperty('madeFor');
    expect(newObject(9100001).onlyDuringQuest).toBeNull();
  });

  it('reads a store, keeping valid entries and dropping the rest', () => {
    const read = readProjectEntities({ npcs: [{ ...newNpc(1), name: 'A' }, { entry: 'x' }], objects: [{ ...newObject(2), onlyDuringQuest: 60001 }], items: 'no' });
    expect(read.npcs.map((n) => n.name)).toEqual(['A']);
    expect(read.objects[0]!.onlyDuringQuest).toBe(60001);
    expect(read.items).toEqual([]);
    expect(readProjectEntities(null)).toEqual(EMPTY_ENTITIES);
  });

  it('drops madeFor from a project saved with it, keeping everything else', () => {
    const old = { ...newNpc(1), name: 'Hela', madeFor: 60001 };
    const read = readProjectEntities({ npcs: [old] }).npcs[0]!;
    expect(read).not.toHaveProperty('madeFor');
    expect(read.name).toBe('Hela');
  });

  it('a fight credit step names the quest it credits, 0 when read from before', () => {
    const fight = (step: object) => fightSchema.parse({ phases: [], abilities: [], reactions: [{ id: 'r1', when: { kind: 'death' }, phases: [], steps: [step] }] });
    const read = fight({ kind: 'credit', objective: 1, group: false, waitMs: 0 });
    expect((read.reactions[0]!.steps[0] as any).quest).toBe(0);
    expect((fight({ kind: 'credit', objective: 2, group: true, waitMs: 0, quest: 60001 }).reactions[0]!.steps[0] as any).quest).toBe(60001);
  });
});

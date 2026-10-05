import { describe, expect, it } from 'vitest';
import { EMPTY_ENTITIES, existingOnly, newItem, newNpc, newObject, newOnly, originOf, readProjectEntities } from '../../src/core/entities/model';
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

  it('everything made in the project is new, and a file saved before origins reads as new', () => {
    expect(newNpc(1).origin).toEqual({ kind: 'new' });
    const { origin: _o, ...old } = newObject(2);
    expect(readProjectEntities({ objects: [old] }).objects[0]!.origin).toEqual({ kind: 'new' });
  });

  it('keeps an existing entity\'s original rows and counts, and splits the store by origin', () => {
    const origin = { kind: 'existing' as const, original: { creature_template: [{ entry: '1423', name: 'Stormwind Guard' }] }, sharedLoot: 2, spawnCount: 12, locked: ['fight' as const] };
    const guard = { ...newNpc(1423), name: 'Stormwind Guard', origin };
    const store = readProjectEntities({ npcs: [newNpc(12000001), guard] });
    expect(store.npcs[1]!.origin).toEqual(origin);
    expect(originOf(store.npcs[1]!)).toBe('existing');
    expect(newOnly(store).npcs.map((n) => n.entry)).toEqual([12000001]);
    expect(existingOnly(store).npcs.map((n) => n.entry)).toEqual([1423]);
  });
});

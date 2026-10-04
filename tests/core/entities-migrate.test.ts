import { describe, expect, it } from 'vitest';
import { migrateQuestEntities } from '../../src/core/entities/migrate';
import { ENTITIES_FIELD, newNpc, newObject, newItem } from '../../src/core/entities/model';

const quest = (questId: number, entities: unknown, other: Record<string, unknown> = {}) =>
  ({ questId, aggregate: { values: { 'quest_template.LogTitle': `Q${questId}`, ...other, ...(entities === undefined ? {} : { [ENTITIES_FIELD]: entities }) } } });
const { madeFor: _a, ...oldNpc } = newNpc(12000001);
const { madeFor: _b, onlyDuringQuest: _c, ...oldObject } = newObject(9100001);
const { madeFor: _d, ...oldItem } = newItem(9200001);

describe('migrateQuestEntities', () => {
  it('moves each quest\'s entities into the store, made for that quest, in quest order', () => {
    const out = migrateQuestEntities([
      quest(60002, { npcs: [{ ...oldNpc, entry: 12000002, name: 'B' }], objects: [], items: [] }),
      quest(60001, { npcs: [{ ...oldNpc, name: 'A' }], objects: [{ ...oldObject, onlyDuringQuest: true }], items: [oldItem] }),
    ]);
    expect(out.entities.npcs.map((n) => [n.name, n.madeFor])).toEqual([['A', 60001], ['B', 60002]]);
    expect(out.entities.objects[0]!.onlyDuringQuest).toBe(60001);
    expect(out.entities.items[0]!.madeFor).toBe(60001);
    expect(out.warnings).toEqual([]);
  });

  it('turns a false only-during-quest into null', () => {
    const out = migrateQuestEntities([quest(60001, { npcs: [], objects: [{ ...oldObject, onlyDuringQuest: false }], items: [] })]);
    expect(out.entities.objects[0]!.onlyDuringQuest).toBeNull();
  });

  it('gives every fight credit step the quest it came from', () => {
    const fight = { phases: [], abilities: [], reactions: [{ id: 'r1', when: { kind: 'death' }, phases: [], steps: [{ kind: 'credit', objective: 1, group: false, waitMs: 0 }] }] };
    const out = migrateQuestEntities([quest(60001, { npcs: [{ ...oldNpc, fight }], objects: [], items: [] })]);
    expect((out.entities.npcs[0]!.fight!.reactions[0]!.steps[0] as any).quest).toBe(60001);
  });

  it('removes the entities field from every quest and leaves the rest', () => {
    const input = [quest(60001, { npcs: [oldNpc], objects: [], items: [] }), quest(60003, undefined)];
    const out = migrateQuestEntities(input);
    expect(out.quests.map((q) => Object.keys(q.aggregate.values))).toEqual([['quest_template.LogTitle'], ['quest_template.LogTitle']]);
    expect(input[0]!.aggregate.values).toHaveProperty(ENTITIES_FIELD);
  });

  it('keeps a duplicate entry once, the first quest\'s, and names both quests', () => {
    const out = migrateQuestEntities([
      quest(60001, { npcs: [{ ...oldNpc, name: 'First' }], objects: [], items: [] }),
      quest(60002, { npcs: [{ ...oldNpc, name: 'Second' }], objects: [], items: [] }),
    ]);
    expect(out.entities.npcs.map((n) => n.name)).toEqual(['First']);
    expect(out.warnings).toEqual(['NPC 12000001 was in quests 60001 and 60002; the one from quest 60001 was kept.']);
  });
});

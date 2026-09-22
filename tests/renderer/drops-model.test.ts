import { describe, it, expect } from 'vitest';
import { listDropSources, addDropSource, removeDropSource, type Values } from '../../src/renderer/groups/drops-model';

const empty = (): Values => ({ creature_loot_template: [], gameobject_loot_template: [], creature_questitem: [], gameobject_questitem: [] });
const wolf = { source: { kind: 'creature' as const, entry: 299 }, chance: 60, minCount: 1, maxCount: 2 };

describe('drops model', () => {
  it('adds a loot row and a questitem row with the next free Idx', () => {
    const v0: Values = { ...empty(), creature_questitem: [{ CreatureEntry: 299, Idx: 0, ItemId: 111, VerifiedBuild: 0 }] };
    const v = addDropSource(v0, 2000, wolf);
    expect(v.creature_loot_template).toEqual([{ Entry: 299, Item: 2000, Reference: 0, Chance: 60, QuestRequired: 1, LootMode: 1, GroupId: 0, MinCount: 1, MaxCount: 2, Comment: null }]);
    expect(v.creature_questitem).toEqual([
      { CreatureEntry: 299, Idx: 0, ItemId: 111, VerifiedBuild: 0 },
      { CreatureEntry: 299, Idx: 1, ItemId: 2000, VerifiedBuild: 0 },
    ]);
    expect(v0.creature_loot_template).toEqual([]);
  });
  it('uses the object tables for objects', () => {
    const v = addDropSource(empty(), 2000, { source: { kind: 'gameobject', entry: 50 }, chance: 100, minCount: 1, maxCount: 1 });
    expect((v.gameobject_loot_template as any[])[0]).toMatchObject({ Entry: 50, Item: 2000 });
    expect((v.gameobject_questitem as any[])[0]).toMatchObject({ GameObjectEntry: 50, Idx: 0, ItemId: 2000 });
    expect(v.creature_loot_template).toEqual([]);
  });
  it('updates an existing source instead of duplicating it', () => {
    const once = addDropSource(empty(), 2000, wolf);
    const twice = addDropSource(once, 2000, { ...wolf, chance: 90 });
    expect(twice.creature_loot_template).toHaveLength(1);
    expect((twice.creature_loot_template as any[])[0].Chance).toBe(90);
    expect(twice.creature_questitem).toHaveLength(1);
  });
  it('lists and removes sources for one item without touching others', () => {
    let v = addDropSource(empty(), 2000, wolf);
    v = addDropSource(v, 3000, wolf);
    expect(listDropSources(v, 2000)).toEqual([wolf]);
    const r = removeDropSource(v, 2000, wolf.source);
    expect(listDropSources(r, 2000)).toEqual([]);
    expect(listDropSources(r, 3000)).toEqual([wolf]);
    expect((r.creature_questitem as any[]).map((x) => x.ItemId)).toEqual([3000]);
  });
});

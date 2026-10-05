import { describe, expect, it } from 'vitest';
import { narrowTo, questRefs, questUses, usedBy } from '../../src/core/entities/links';
import { newItem, newNpc, newObject, type ProjectEntities } from '../../src/core/entities/model';
import { SCRIPTS_FIELD } from '../../src/core/scripts/model';

const creditFight = (quest: number) => ({ phases: [], abilities: [], reactions: [{ id: 'r1', when: { kind: 'death' as const }, phases: [], steps: [{ kind: 'credit' as const, objective: 1 as const, group: false, quest, waitMs: 0 }] }] });
const store: ProjectEntities = {
  npcs: [newNpc(12000001), newNpc(12000002), newNpc(12000003), newNpc(12000004), { ...newNpc(12000005), fight: creditFight(60001) }, newNpc(12000006), { ...newNpc(12000007), fight: creditFight(60002) }],
  objects: [newObject(9100001), newObject(9100002), newObject(9100003)],
  items: [newItem(9200001), newItem(9200002), newItem(9200003), newItem(9200004)],
};
const q = (questId: number, values: Record<string, unknown>) => ({ questId, aggregate: { values } });

describe('questUses', () => {
  it('finds givers, enders, objectives, scenes and credit fights', () => {
    const quest = q(60001, {
      creature_queststarter: [{ id: 12000001 }],
      gameobject_questender: [{ id: 9100001 }],
      'quest_template.RequiredNpcOrGo': [{ target: { target: 'creature', id: 12000003 }, count: 1 }, { target: { target: 'gameobject', id: 9100002 }, count: 1 }],
      [SCRIPTS_FIELD]: [{ id: 's1', name: '', owner: { kind: 'creature', entry: 12000004 }, trigger: { kind: 'questAccepted' }, gates: [],
        steps: [{ kind: 'spawnNpc', entry: 12000006, at: { x: 0, y: 0, z: 0, o: 0 }, despawnAfterS: 0, attackPlayer: false, waitMs: 0 },
          { kind: 'objectState', state: 'open', entry: 9100003, range: 10, waitMs: 0 }, { kind: 'giveItem', item: 9200004, count: 1, waitMs: 0 }] }],
      'quest_template.RequiredItems': [{ item: 9200001, count: 1 }],
      'quest_template.RewardItems': [{ item: 9200002, amount: 1 }],
      'quest_template.StartItem': 9200003,
      creature_questender: [{ id: 1423 }],
    });
    expect(questUses(quest, store)).toEqual({
      npcs: [12000001, 12000003, 12000004, 12000005, 12000006],
      objects: [9100001, 9100002, 9100003],
      items: [9200001, 9200002, 9200003, 9200004],
    });
  });

  it('a quest that names nothing uses nothing but the NPCs whose fights credit it', () => {
    expect(questUses(q(60009, {}), store)).toEqual({ npcs: [], objects: [], items: [] });
    expect(questUses(q(60001, {}), store)).toEqual({ npcs: [12000005], objects: [], items: [] });
  });

  it('questRefs lists what a quest names, project entity or not, without credits', () => {
    const quest = q(60001, { creature_queststarter: [{ id: 1423 }, { id: 12000001 }], 'quest_template.RewardItems': [{ item: 2589, amount: 1 }] });
    expect(questRefs(quest)).toEqual({ npcs: [1423, 12000001], objects: [], items: [2589] });
  });

  it('lists the quests that use an entity, and narrows a store to a use', () => {
    const quests = [q(60002, { creature_queststarter: [{ id: 12000001 }] }), q(60001, { creature_questender: [{ id: 12000001 }] })];
    expect(usedBy('npc', 12000001, quests, store)).toEqual([60001, 60002]);
    expect(usedBy('npc', 12000002, quests, store)).toEqual([]);
    expect(usedBy('npc', 12000007, quests, store)).toEqual([60002]);
    expect(usedBy('item', 9200001, quests, store)).toEqual([]);
    expect(narrowTo(store, { npcs: [12000002], objects: [], items: [9200001] })).toEqual({ npcs: [store.npcs[1]], objects: [], items: [store.items[0]] });
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { planCandidateImport, type PlanContext } from '../../src/core/import/candidate';
import { registry } from '../../src/core/registry';
import { loadSchema } from '../../src/core/schema/load';
import { forkDb } from '../helpers/fixtures';
import { newNpc } from '../../src/core/entities/model';
import type { CandidatePayload } from '../../src/shared/candidate';

const fixture = (n: number): CandidatePayload => JSON.parse(readFileSync(`tests/fixtures/candidates/p${n}.json`, 'utf8'));
const world = new Map<string, string>([['npc:18200', "Shado 'Fitz' Farstrider"], ['npc:17128', 'Windroc'], ['item:375250', 'Token'], ['item:56918', 'Coin'], ['object:192112', 'Altar'], ['item:65323', 'A'], ['item:6665358', 'B']]);

async function ctx(over: Partial<PlanContext> = {}): Promise<PlanContext> {
  const schema = await loadSchema(forkDb(), registry.tables.map((t) => t.table));
  return {
    schema, registry, projectQuestIds: new Set(), projectEntities: { npcs: [], objects: [], items: [] }, worldQuestIds: new Set(),
    worldHas: (k, e) => world.has(`${k}:${e}`), worldName: (k, e) => world.get(`${k}:${e}`) ?? null, ...over,
  };
}

describe('planCandidateImport', () => {
  it('turns a Ready candidate into a quest with its giver and ender', async () => {
    const plan = planCandidateImport([fixture(1209)], await ctx());
    const q = plan.quests[0]!;
    expect(q).toMatchObject({ questId: 1209, title: 'Windroc Remastery I', action: 'create' });
    expect(q.values['quest_template.ID']).toBe(1209);
    expect(q.values['quest_template.LogTitle']).toBe('Windroc Remastery I');
    expect(String(q.values['quest_template.QuestDescription'])).toContain('$B$BNagrand');
    expect(q.values.creature_queststarter).toEqual([{ id: 18200 }]);
    expect(q.values.creature_questender).toEqual([{ id: 18200 }]);
    expect(q.givers).toEqual([{ kind: 'npc', entry: 18200, how: 'return wording' }]);
    expect(q.creates).toEqual({ npcs: [], objects: [], items: [] });
    expect(q.references.map((r) => [r.kind, r.entry, r.where])).toEqual([['npc', 18200, 'world'], ['npc', 17128, 'world'], ['item', 375250, 'world']]);
  });
  it('creates a missing NPC from its record, keeping its entry', async () => {
    const q = planCandidateImport([fixture(1215)], await ctx()).quests[0]!;
    expect(q.creates.npcs).toEqual([{ ...newNpc(2), name: 'Brun', subname: 'Crimson Templar', minLevel: 73, maxLevel: 73, faction: 35, displayId: 12129, scale: 1, rank: 'boss', type: 'elemental', healthModifier: 1500, damageModifier: 1 }]);
    expect(q.notImported).toContain('creature_template.family');
    expect(q.evaluation.blockers).toEqual(['Target NPC not placeable: Brun (2)']);
  });
  it('creates missing objects, and references an object another quest in the plan already creates', async () => {
    const q1224 = fixture(1224);
    const plan = planCandidateImport([q1224, { ...q1224, quest: { quest_template: { ...(q1224.quest.quest_template as object), ID: 91224 } } }], await ctx());
    const [a, b] = plan.quests;
    expect(a!.creates.objects.map((o) => [o.entry, o.name, o.type])).toEqual([[402000, "Hero's Call Board", 'questGiver'], [412000, expect.any(String), expect.any(String)]]);
    expect(b!.creates.objects).toEqual([]);
    expect(b!.references.filter((r) => r.where === 'plan').map((r) => r.entry)).toEqual([402000, 412000, 33]);
  });
  it('lists a dependency with no record as unresolved and still plans the quest', async () => {
    const q = planCandidateImport([fixture(28394)], await ctx()).quests[0]!;
    expect(q.action).toBe('create');
    expect(q.unresolved).toEqual([{ kind: 'item', entry: 65359, reason: 'The tracker has no data for it.' }]);
  });
  it('replaces a quest already in the project and skips one already in the world', async () => {
    const plan = planCandidateImport([fixture(1209), fixture(1215)], await ctx({ projectQuestIds: new Set([1209]), worldQuestIds: new Set([1215]) }));
    expect(plan.quests.map((q) => [q.questId, q.action, q.reason ?? null])).toEqual([
      [1209, 'replace', null],
      [1215, 'skip', 'Quest 1215 is already in the world DB (the tracker\'s last snapshot is older).'],
    ]);
  });
  it('references an NPC the project already has instead of copying it', async () => {
    const q = planCandidateImport([fixture(1215)], await ctx({ projectEntities: { npcs: [{ ...newNpc(2), name: 'Brun' }], objects: [], items: [] } })).quests[0]!;
    expect(q.creates.npcs).toEqual([]);
    expect(q.references).toContainEqual({ kind: 'npc', entry: 2, name: 'Brun', where: 'project' });
  });
  it('refuses to create over a world entry that holds something else', async () => {
    const q = planCandidateImport([fixture(1215)], await ctx({ worldHas: (k, e) => world.has(`${k}:${e}`) || (k === 'npc' && e === 2), worldName: (k, e) => (k === 'npc' && e === 2 ? 'Someone Else' : world.get(`${k}:${e}`) ?? null) })).quests[0]!;
    expect(q.creates.npcs).toEqual([]);
    expect(q.references).toContainEqual({ kind: 'npc', entry: 2, name: 'Someone Else', where: 'world' });
  });
  it('maps an item record, keeping unknown columns in advanced', async () => {
    const p = fixture(28394);
    const withItem: CandidatePayload = { ...p, dependencies: p.dependencies.map((d) => (d.entry === 65359 ? { ...d, status: 'template', record: {
      item_template: { entry: 65359, name: 'Sealed Orders', class: 12, subclass: 0, Quality: 1, bonding: 4, stackable: 1, maxcount: 1, displayid: 1134, startquest: 28394, holy_res: 2 },
      _extra: { stats: [], unmapped: { InventoryType: 'Weird' } }, _sources: {} } } : d)) };
    const q = planCandidateImport([withItem], await ctx()).quests[0]!;
    expect(q.creates.items).toEqual([expect.objectContaining({ entry: 65359, name: 'Sealed Orders', bonding: 'quest', displayId: 1134, startsQuest: 28394, advanced: { holy_res: '2' } })]);
    expect(q.notImported).toContain('item_template.InventoryType (Weird)');
    expect(q.unresolved).toEqual([]);
  });
  it('lists payload columns the schema cannot hold as not imported', async () => {
    const p = fixture(1209);
    const odd = { ...p, quest: { ...p.quest, quest_template: { ...(p.quest.quest_template as object), NotAColumn: 5 } } };
    const q = planCandidateImport([odd], await ctx()).quests[0]!;
    expect(q.notImported).toContain('quest_template.NotAColumn');
  });
});

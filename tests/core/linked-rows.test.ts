import { describe, it, expect } from 'vitest';
import { importFixture, forkDb } from '../helpers/fixtures';
import { buildPatch } from '@core/export/build-patch';
import { fetchLinkedContext } from '@core/import/linked-context';
import { verifyRoundTrip } from '@core/roundtrip/verify';
import { registry } from '@core/registry';

const seed = () => {
  const db = forkDb();
  db.insert('quest_template', { ID: '60001', RequiredItemId1: '2000', RequiredItemCount1: '5', StartItem: '2001' });
  db.insert('quest_template', { ID: '60002', RequiredItemId1: '2000' });
  db.insert('creature_loot_template', { Entry: '100', Item: '2000', Chance: '75', QuestRequired: '1' });
  db.insert('creature_loot_template', { Entry: '101', Item: '2000', Chance: '5', QuestRequired: '0' });
  db.insert('creature_loot_template', { Entry: '102', Item: '3000', Chance: '5', QuestRequired: '1' });
  db.insert('creature_questitem', { CreatureEntry: '100', Idx: '0', ItemId: '2000' });
  db.insert('gameobject_questitem', { GameObjectEntry: '500', Idx: '0', ItemId: '2001' });
  db.insert('quest_template_locale', { ID: '60001', locale: 'deDE', Title: 'Titel' });
  return db;
};
const stmts = (p: any, table: string, kind: string) => p.statements.filter((s: any) => s.table === table && s.kind === kind);

describe('linked rows', () => {
  it('imports only quest-required loot for the quest\'s items, plus questitem rows', async () => {
    const { aggregate } = await importFixture(seed(), 60001);
    expect((aggregate.values['creature_loot_template'] as any[]).map((r) => r.Entry)).toEqual([100]);
    expect((aggregate.values['creature_questitem'] as any[]).map((r) => r.CreatureEntry)).toEqual([100]);
    expect((aggregate.values['gameobject_questitem'] as any[]).map((r) => r.GameObjectEntry)).toEqual([500]);
  });

  it('records other quests that share an item', async () => {
    const { aggregate } = await importFixture(seed(), 60001);
    expect(aggregate.sharedItems).toEqual({ '2000': [60002] });
  });

  it('emits nothing for unchanged linked rows and round-trips', async () => {
    const { aggregate, snapshot, schema } = await importFixture(seed(), 60001);
    const p = buildPatch({ aggregate, snapshot, schema, registry });
    expect(stmts(p, 'creature_loot_template', 'insert')).toEqual([]);
    expect(stmts(p, 'creature_loot_template', 'delete')).toEqual([]);
    expect(verifyRoundTrip({ aggregate, snapshot, schema, registry })).toEqual({ ok: true });
  });

  it('modifying a shared row emits a scoped delete/insert and warns', async () => {
    const { aggregate, snapshot, schema } = await importFixture(seed(), 60001);
    const rows = (aggregate.values['creature_loot_template'] as any[]).map((r) => ({ ...r, Chance: 90 }));
    const p = buildPatch({ aggregate: { ...aggregate, values: { ...aggregate.values, creature_loot_template: rows } }, snapshot, schema, registry });
    expect(stmts(p, 'creature_loot_template', 'delete')).toEqual([{ kind: 'delete', table: 'creature_loot_template', key: { Entry: '100', Item: '2000', Reference: '0', GroupId: '0' } }]);
    expect(stmts(p, 'creature_loot_template', 'insert')[0].row.Chance).toBe('90');
    expect(p.warnings.map((w) => w.code)).toContain('SHARED_ROW_MODIFIED');
  });

  it('flags an added loot row whose item is not one of the quest items', async () => {
    const { aggregate, snapshot, schema } = await importFixture(seed(), 60001);
    const added = { Entry: 200, Item: 4242, Reference: 0, Chance: 10, QuestRequired: 1, LootMode: 1, GroupId: 0, MinCount: 1, MaxCount: 1, Comment: null };
    const rows = [...(aggregate.values['creature_loot_template'] as any[]), added];
    const p = buildPatch({ aggregate: { ...aggregate, values: { ...aggregate.values, creature_loot_template: rows } }, snapshot, schema, registry });
    expect(p.warnings.map((w) => w.code)).toContain('LINKED_ROW_NOT_QUEST_ITEM');
  });

  it('removing a linked row emits only its exact-key delete', async () => {
    const { aggregate, snapshot, schema } = await importFixture(seed(), 60001);
    const p = buildPatch({ aggregate: { ...aggregate, values: { ...aggregate.values, creature_questitem: [] } }, snapshot, schema, registry });
    expect(stmts(p, 'creature_questitem', 'delete')).toHaveLength(1);
    expect(stmts(p, 'creature_questitem', 'insert')).toEqual([]);
  });

  // C1: the item-keyed fetch only ever sees rows for THIS quest's items, so the rows a new drop
  // source would land on top of are invisible — and the patch used to delete them without a word.
  describe('rows the quest does not own but would collide with', () => {
    const ctx = async (db: any, agg: any, snapshot: any, schema: any) =>
      fetchLinkedContext({ db, registry, schema, tables: snapshot.tables, values: agg.values });

    const addedQuestItem = (aggregate: any, entry: number, idx: number, item: number) => ({
      ...aggregate.values,
      creature_questitem: [
        ...(aggregate.values['creature_questitem'] as any[]),
        { CreatureEntry: entry, Idx: idx, ItemId: item, VerifiedBuild: 0 },
      ],
    });

    it('fetches the other rows of every entry the quest touches, minus its own', async () => {
      const db = seed();
      db.insert('creature_questitem', { CreatureEntry: '100', Idx: '1', ItemId: '9999' });
      const { aggregate, snapshot, schema } = await importFixture(db, 60001);
      // Only (100,0,2000) is the quest's; (100,1,9999) belongs to somebody else.
      expect((aggregate.values['creature_questitem'] as any[]).map((r) => r.Idx)).toEqual([0]);
      const context = await ctx(db, aggregate, snapshot, schema);
      expect(context['creature_questitem']).toEqual([expect.objectContaining({ CreatureEntry: '100', Idx: '1', ItemId: '9999' })]);
      expect(snapshot.linkedContext['creature_questitem']).toEqual(context['creature_questitem']);
    });

    it('never deletes or rekeys another quest\'s questitem row when a drop source is added', async () => {
      const db = seed();
      // Creature 200 already shows item 9999 in slot 0 for a different quest.
      db.insert('creature_questitem', { CreatureEntry: '200', Idx: '0', ItemId: '9999' });
      const { aggregate, snapshot, schema } = await importFixture(db, 60001);
      const values = addedQuestItem(aggregate, 200, 0, 2000); // the slot the UI can see is 0
      const linkedContext = await fetchLinkedContext({ db, registry, schema, tables: snapshot.tables, values });
      const p = buildPatch({ aggregate: { ...aggregate, values }, snapshot, schema, registry, linkedContext });

      expect(stmts(p, 'creature_questitem', 'delete').map((s: any) => s.key)).not.toContainEqual({ CreatureEntry: '200', Idx: '0' });
      const mine = stmts(p, 'creature_questitem', 'insert').map((s: any) => s.row).filter((r: any) => r.CreatureEntry === '200');
      expect(mine).toHaveLength(1);
      expect(mine[0].ItemId).toBe('2000');
      expect(mine[0].Idx).toBe('1'); // moved off the taken slot
      expect(p.warnings.map((w) => w.code)).toContain('LINKED_ROW_COLLISION');
      expect(p.warnings.find((w) => w.code === 'LINKED_ROW_COLLISION')!.message).toContain('9999');
    });

    it('keeps an ordinary non-quest loot row at the same key alive, and says it is changing it', async () => {
      const db = seed();
      db.insert('creature_loot_template', {
        Entry: '103', Item: '2000', Chance: '5', QuestRequired: '0', LootMode: '3', Comment: 'ordinary drop',
      });
      const { aggregate, snapshot, schema } = await importFixture(db, 60001);
      // The importer cannot see it: QuestRequired = 0 is filtered out of the item-keyed fetch.
      expect((aggregate.values['creature_loot_template'] as any[]).map((r) => r.Entry)).toEqual([100]);

      const added = { Entry: 103, Item: 2000, Reference: 0, Chance: 100, QuestRequired: 1, LootMode: 1, GroupId: 0, MinCount: 1, MaxCount: 1, Comment: null };
      const values = { ...aggregate.values, creature_loot_template: [...(aggregate.values['creature_loot_template'] as any[]), added] };
      const linkedContext = await fetchLinkedContext({ db, registry, schema, tables: snapshot.tables, values });
      expect(linkedContext['creature_loot_template']).toHaveLength(1);

      const p = buildPatch({ aggregate: { ...aggregate, values }, snapshot, schema, registry, linkedContext });
      const key = { Entry: '103', Item: '2000', Reference: '0', GroupId: '0' };
      // Deleted and re-inserted, never deleted and dropped: the row is still there afterwards.
      const inserted = stmts(p, 'creature_loot_template', 'insert').map((s: any) => s.row).filter((r: any) => r.Entry === '103');
      expect(inserted).toHaveLength(1);
      expect(stmts(p, 'creature_loot_template', 'delete').map((s: any) => s.key)).toContainEqual(key);
      expect(inserted[0].QuestRequired).toBe('1');
      // The warning has to say what is being replaced, or the overwrite is still effectively silent.
      const warning = p.warnings.find((w) => w.code === 'LINKED_ROW_COLLISION');
      expect(warning, 'the overwrite must not be silent').toBeDefined();
      expect(warning!.message).toContain('Entry=103');
      expect(warning!.message).toContain('ordinary drop');
      expect(warning!.message).toContain('LootMode=3');
      expect(warning!.message).toContain('Chance=5');
    });

    it('never deletes a context row it is not replacing', async () => {
      const db = seed();
      db.insert('creature_questitem', { CreatureEntry: '100', Idx: '1', ItemId: '9999' });
      const { aggregate, snapshot, schema } = await importFixture(db, 60001);
      // The user removes the quest's own row for creature 100; the neighbour must be left alone.
      const values = { ...aggregate.values, creature_questitem: [] };
      const linkedContext = await fetchLinkedContext({ db, registry, schema, tables: snapshot.tables, values });
      const p = buildPatch({ aggregate: { ...aggregate, values }, snapshot, schema, registry, linkedContext });
      const keys = stmts(p, 'creature_questitem', 'delete').map((s: any) => s.key);
      expect(keys).toEqual([{ CreatureEntry: '100', Idx: '0' }]);
      expect(keys).not.toContainEqual({ CreatureEntry: '100', Idx: '1' });
    });

    it('moves past a slot the quest holds itself as well as one another quest holds', async () => {
      const db = seed();
      // Creature 100 slot 0 is this quest's (item 2000); slot 1 is somebody else's.
      db.insert('creature_questitem', { CreatureEntry: '100', Idx: '1', ItemId: '9999' });
      const { aggregate, snapshot, schema } = await importFixture(db, 60001);
      // The user adds the start item (2001) to creature 100, and the UI picks slot 1.
      const values = addedQuestItem(aggregate, 100, 1, 2001);
      const linkedContext = await fetchLinkedContext({ db, registry, schema, tables: snapshot.tables, values });
      const p = buildPatch({ aggregate: { ...aggregate, values }, snapshot, schema, registry, linkedContext });
      const added = stmts(p, 'creature_questitem', 'insert').map((s: any) => s.row).find((r: any) => r.ItemId === '2001');
      expect(added.Idx).toBe('2'); // 0 is ours, 1 is theirs
      expect(stmts(p, 'creature_questitem', 'delete').map((s: any) => s.key)).not.toContainEqual({ CreatureEntry: '100', Idx: '1' });
    });

    it('is quiet when the added row collides with nothing', async () => {
      const db = seed();
      const { aggregate, snapshot, schema } = await importFixture(db, 60001);
      const values = addedQuestItem(aggregate, 777, 0, 2000);
      const linkedContext = await fetchLinkedContext({ db, registry, schema, tables: snapshot.tables, values });
      const p = buildPatch({ aggregate: { ...aggregate, values }, snapshot, schema, registry, linkedContext });
      expect(p.warnings.map((w) => w.code)).not.toContain('LINKED_ROW_COLLISION');
      expect(stmts(p, 'creature_questitem', 'insert').map((s: any) => s.row).find((r: any) => r.CreatureEntry === '777').Idx).toBe('0');
    });

    it('still round-trips an untouched quest, context or no context', async () => {
      const db = seed();
      db.insert('creature_questitem', { CreatureEntry: '100', Idx: '1', ItemId: '9999' });
      db.insert('creature_loot_template', { Entry: '100', Item: '4321', Chance: '5', QuestRequired: '0' });
      const { aggregate, snapshot, schema } = await importFixture(db, 60001);
      expect(snapshot.linkedContext['creature_questitem'].length).toBeGreaterThan(0);
      expect(verifyRoundTrip({ aggregate, snapshot, schema, registry })).toEqual({ ok: true });
      const p = buildPatch({ aggregate, snapshot, schema, registry });
      expect(p.statements.filter((s) => s.table === 'creature_questitem')).toEqual([]);
      expect(p.warnings.map((w) => w.code)).not.toContain('LINKED_ROW_COLLISION');
    });
  });

  it('keeps locale rows in the snapshot and never touches them', async () => {
    const { aggregate, snapshot, schema } = await importFixture(seed(), 60001);
    expect(snapshot.tables['quest_template_locale']).toHaveLength(1);
    const p = buildPatch({ aggregate, snapshot, schema, registry });
    expect(p.statements.some((s) => s.table === 'quest_template_locale')).toBe(false);
  });

  it('registers every table in the spec\'s quest set', () => {
    expect(registry.tables.map((t) => t.table).sort()).toEqual([
      'areatrigger_involvedrelation', 'conditions', 'creature_loot_template', 'creature_questender', 'creature_questitem',
      'creature_queststarter', 'game_event_creature_quest', 'game_event_gameobject_quest', 'gameobject_loot_template',
      'gameobject_questender', 'gameobject_questitem', 'gameobject_queststarter', 'pool_quest', 'quest_details',
      'quest_mail_sender', 'quest_offer_reward', 'quest_offer_reward_locale', 'quest_poi', 'quest_poi_points',
      'quest_request_items', 'quest_request_items_locale', 'quest_template', 'quest_template_addon', 'quest_template_locale',
    ].sort());
  });
});

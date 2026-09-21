import { describe, it, expect } from 'vitest';
import { importFixture, forkDb } from '../helpers/fixtures';
import { buildPatch } from '@core/export/build-patch';
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

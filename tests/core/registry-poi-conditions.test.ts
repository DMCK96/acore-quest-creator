import { describe, it, expect } from 'vitest';
import { importFixture, forkDb } from '../helpers/fixtures';
import { buildPatch } from '@core/export/build-patch';
import { verifyRoundTrip } from '@core/roundtrip/verify';
import { registry, tableDef } from '@core/registry';

const seed = () => {
  const db = forkDb();
  db.insert('quest_template', { ID: '60001' });
  db.insert('quest_poi', { QuestID: '60001', id: '1', ObjectiveIndex: '0', MapID: '0', Priority: '3' });
  db.insert('quest_poi_points', { QuestID: '60001', Idx1: '1', Idx2: '0', X: '-9000', Y: '-100' });
  db.insert('quest_poi_points', { QuestID: '60001', Idx1: '1', Idx2: '1', X: '-9010', Y: '-110' });
  db.insert('conditions', { SourceTypeOrReferenceId: '19', SourceEntry: '60001', ConditionTypeOrReference: '8', ConditionValue1: '60000', Comment: null });
  db.insert('conditions', { SourceTypeOrReferenceId: '19', SourceEntry: '60001', ConditionTypeOrReference: '8', ConditionValue1: '60002', Comment: '' });
  db.insert('conditions', { SourceTypeOrReferenceId: '1', SourceEntry: '60001', ConditionTypeOrReference: '8', ConditionValue1: '1' });
  db.insert('conditions', { SourceTypeOrReferenceId: '19', SourceEntry: '9999', ConditionTypeOrReference: '8', ConditionValue1: '1' });
  return db;
};

describe('POI and conditions', () => {
  it('imports POI and points for the quest only', async () => {
    const { aggregate } = await importFixture(seed(), 60001);
    expect((aggregate.values['quest_poi'] as any[]).length).toBe(1);
    expect((aggregate.values['quest_poi_points'] as any[]).map((p) => [p.Idx1, p.Idx2, p.X, p.Y])).toEqual([[1, 0, -9000, -100], [1, 1, -9010, -110]]);
  });

  it('imports only QUEST_AVAILABLE conditions for this quest', async () => {
    const { aggregate, snapshot } = await importFixture(seed(), 60001);
    expect((aggregate.values['conditions'] as any[]).length).toBe(2);
    expect(snapshot.tables['conditions'].every((r) => r.SourceTypeOrReferenceId === '19' && r.SourceEntry === '60001')).toBe(true);
    expect(tableDef('conditions').keyColumns).toHaveLength(10);
  });

  it('round-trips, preserving NULL versus empty Comment', async () => {
    const { aggregate, snapshot, schema } = await importFixture(seed(), 60001);
    expect(verifyRoundTrip({ aggregate, snapshot, schema, registry })).toEqual({ ok: true });
    const comments = snapshot.tables['conditions'].map((r) => r.Comment).sort();
    expect(comments).toEqual(['', null]);
  });

  it('adding a condition stamps the fixed source type and the quest id', async () => {
    const { aggregate, snapshot, schema } = await importFixture(seed(), 60001);
    const added = { ConditionTypeOrReference: 8, ConditionValue1: 60005, SourceGroup: 0, SourceId: 0, ElseGroup: 0, ConditionTarget: 0, ConditionValue2: 0, ConditionValue3: 0, NegativeCondition: 0, ErrorType: 0, ErrorTextId: 0, ScriptName: '', Comment: 'needs quest 60005' };
    const edited = { ...aggregate, values: { ...aggregate.values, conditions: [...(aggregate.values['conditions'] as any[]), added] } };
    const p = buildPatch({ aggregate: edited, snapshot, schema, registry });
    const row = (p.statements.filter((s) => s.kind === 'insert' && s.table === 'conditions') as any[]).map((s) => s.row).find((r) => r.ConditionValue1 === '60005');
    expect(row).toMatchObject({ SourceTypeOrReferenceId: '19', SourceEntry: '60001', Comment: 'needs quest 60005' });
  });
});

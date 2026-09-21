import { describe, it, expect } from 'vitest';
import { importFixture, forkDb } from '../helpers/fixtures';
import { buildPatch } from '@core/export/build-patch';
import { renderPatch, patchFileName } from '@core/export/render-patch';
import { registry } from '@core/registry';
import type { QuestAggregate } from '@core/model/aggregate';

async function setup(rows: Record<string, string | null> = {}) {
  const db = forkDb();
  db.insert('quest_template', { ID: '60001', LogTitle: 'Test', ...rows });
  return importFixture(db, 60001);
}
const edit = (a: QuestAggregate, values: Record<string, any>): QuestAggregate => ({ ...a, values: { ...a.values, ...values } });
const inserts = (p: ReturnType<typeof buildPatch>, table: string) => p.statements.filter((s) => s.kind === 'insert' && s.table === table) as any[];

describe('buildPatch', () => {
  it('re-emits owned rows verbatim when nothing changed', async () => {
    const { aggregate, snapshot, schema } = await setup({ RewardItem2: '5', RewardAmount2: '1' });
    const p = buildPatch({ aggregate, snapshot, schema, registry });
    expect(inserts(p, 'quest_template')[0].row).toEqual(snapshot.tables['quest_template'][0]);
    expect(p.statements.find((s) => s.kind === 'delete' && s.table === 'quest_template')).toEqual({ kind: 'delete', table: 'quest_template', key: { ID: '60001' } });
  });

  it('changes only the edited columns and keeps unknown columns', async () => {
    const db = forkDb();
    db.addColumn('quest_template', { name: 'FutureCol', dataType: 'int', columnType: 'int', nullable: false, default: '0', ordinal: 106, isKey: false });
    db.insert('quest_template', { ID: '60001', LogTitle: 'Old', FutureCol: '9' });
    const { aggregate, snapshot, schema } = await importFixture(db, 60001);
    const p = buildPatch({ aggregate: edit(aggregate, { 'quest_template.LogTitle': 'New' }), snapshot, schema, registry });
    const row = inserts(p, 'quest_template')[0].row;
    expect(row.LogTitle).toBe('New');
    expect(row.FutureCol).toBe('9');
    const before = snapshot.tables['quest_template'][0];
    for (const k of Object.keys(before)) if (k !== 'LogTitle') expect(row[k], k).toBe(before[k]);
  });

  it('keeps slot gaps in untouched lists and compacts touched ones', async () => {
    const { aggregate, snapshot, schema } = await setup({ RewardItem1: '0', RewardAmount1: '0', RewardItem2: '5', RewardAmount2: '1' });
    const untouched = buildPatch({ aggregate, snapshot, schema, registry });
    expect(inserts(untouched, 'quest_template')[0].row.RewardItem2).toBe('5');
    const touched = buildPatch({ aggregate: edit(aggregate, { 'quest_template.RewardItems': [{ item: 5, amount: 2 }] }), snapshot, schema, registry });
    const row = inserts(touched, 'quest_template')[0].row;
    expect([row.RewardItem1, row.RewardAmount1, row.RewardItem2]).toEqual(['5', '2', '0']);
  });

  it('keeps NULL in the unused text slots of a touched list', async () => {
    const { aggregate, snapshot, schema } = await setup({ ObjectiveText1: 'Speak to him.' });
    const before = snapshot.tables['quest_template'][0];
    expect([before.ObjectiveText2, before.ObjectiveText3, before.ObjectiveText4]).toEqual([null, null, null]);
    const p = buildPatch({ aggregate: edit(aggregate, { 'quest_template.ObjectiveText': [{ text: 'Talk to him.' }] }), snapshot, schema, registry });
    const row = inserts(p, 'quest_template')[0].row;
    expect(row.ObjectiveText1).toBe('Talk to him.');
    expect([row.ObjectiveText2, row.ObjectiveText3, row.ObjectiveText4]).toEqual([null, null, null]);
  });

  it('never overlays a read-only field', async () => {
    const { aggregate, snapshot, schema } = await setup({ RewardMoney: 'garbage' });
    const p = buildPatch({ aggregate: edit(aggregate, { 'quest_template.RewardMoney': 5 }), snapshot, schema, registry });
    expect(inserts(p, 'quest_template')[0].row.RewardMoney).toBe('garbage');
  });

  it('emits no row for an absent optional table unless it was edited', async () => {
    const { aggregate, snapshot, schema } = await setup();
    const p = buildPatch({ aggregate, snapshot, schema, registry });
    expect(inserts(p, 'quest_template_addon')).toEqual([]);
    const p2 = buildPatch({ aggregate: edit(aggregate, { 'quest_template_addon.PrevQuestID': 55 }), snapshot, schema, registry });
    expect(inserts(p2, 'quest_template_addon')[0].row).toMatchObject({ ID: '60001', PrevQuestID: '55' });
  });

  it('builds a new quest from column defaults, with deletes for re-applicability', async () => {
    const { aggregate, schema } = await setup();
    const fresh: QuestAggregate = { ...aggregate, isNew: true, questId: 60009,
      values: { ...aggregate.values, 'quest_template.ID': 60009, 'quest_template.LogTitle': 'Fresh' } };
    const p = buildPatch({ aggregate: fresh, snapshot: null, schema, registry });
    expect(inserts(p, 'quest_template')[0].row).toMatchObject({ ID: '60009', LogTitle: 'Fresh', RewardItem1: '0' });
    expect(inserts(p, 'quest_template_addon')[0].row.ID).toBe('60009');
    expect(p.statements.some((s) => s.kind === 'delete' && s.table === 'quest_template' && s.key.ID === '60009')).toBe(true);
  });

  it('adds idempotent quest-giver flag updates after the deletes and before the inserts, with a notice each', async () => {
    const { aggregate, snapshot, schema } = await setup();
    const p = buildPatch({ aggregate, snapshot, schema, registry, questGiverFixes: [200, 100, 100] });
    expect(p.statements.filter((s) => s.kind === 'set-flag')).toEqual([
      { kind: 'set-flag', table: 'creature_template', column: 'npcflag', bit: 2, key: { entry: '100' } },
      { kind: 'set-flag', table: 'creature_template', column: 'npcflag', bit: 2, key: { entry: '200' } },
    ]);
    const kinds = p.statements.map((s) => s.kind);
    expect(kinds.indexOf('set-flag')).toBeGreaterThan(kinds.lastIndexOf('delete'));
    expect(kinds.lastIndexOf('set-flag')).toBeLessThan(kinds.indexOf('insert'));
    expect(p.warnings.filter((w) => w.code === 'QUESTGIVER_FLAG_ADDED')).toHaveLength(2);
    expect(buildPatch({ aggregate, snapshot, schema, registry }).statements.some((s) => s.kind === 'set-flag')).toBe(false);
  });

  it('orders deletes before inserts', async () => {
    const { aggregate, snapshot, schema } = await setup();
    const kinds = buildPatch({ aggregate, snapshot, schema, registry }).statements.map((s) => s.kind);
    expect(kinds.lastIndexOf('delete')).toBeLessThan(kinds.indexOf('insert'));
  });
});

describe('renderPatch and patchFileName', () => {
  it('renders a header, deletes then inserts, and ends with a newline', async () => {
    const { aggregate, snapshot, schema } = await setup({ LogTitle: "O'Neil" });
    const sql = renderPatch(buildPatch({ aggregate, snapshot, schema, registry }).statements, schema, { toolVersion: '0.1.0', questId: 60001, date: '2026_09_21' });
    const lines = sql.split('\n');
    expect(lines[0]).toBe('-- ACORE Quest Creator 0.1.0');
    expect(sql).toContain('-- Quest: 60001');
    expect(sql).toContain(`-- Schema: ${schema.hash}`);
    expect(sql).toContain('DELETE FROM `quest_template` WHERE `ID` = 60001;');
    expect(sql).toContain("'O\\'Neil'");
    expect(sql.endsWith(';\n')).toBe(true);
    expect(sql.indexOf('DELETE FROM')).toBeLessThan(sql.indexOf('INSERT INTO'));
  });
  it('renders the flag update as an idempotent bitwise OR and rejects unsafe values', async () => {
    const { aggregate, snapshot, schema } = await setup();
    const p = buildPatch({ aggregate, snapshot, schema, registry, questGiverFixes: [100] });
    const sql = renderPatch(p.statements, schema, { toolVersion: '0.1.0', questId: 60001, date: '2026_09_21' });
    expect(sql).toContain('UPDATE `creature_template` SET `npcflag` = `npcflag` | 2 WHERE `entry` = 100;');
    expect(() => renderPatch([{ kind: 'set-flag', table: 'creature_template', column: 'npcflag', bit: 2, key: { entry: '1 OR 1=1' } }], schema, { toolVersion: 'v', questId: 1, date: 'd' })).toThrow();
  });
  it('builds slugged file names', () => {
    expect(patchFileName({ date: '2026_09_21', sequence: 0, questId: 60001, title: "Wolves of Elwynn!" }))
      .toBe('2026_09_21_00_quest_60001_wolves_of_elwynn.sql');
    expect(patchFileName({ date: '2026_09_21', sequence: 12, questId: 5, title: '' })).toBe('2026_09_21_12_quest_5_untitled.sql');
    expect(patchFileName({ date: 'd', sequence: 1, questId: 1, title: 'x'.repeat(100) }).length).toBeLessThan(80);
  });
});

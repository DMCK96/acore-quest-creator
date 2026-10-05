import { describe, expect, it } from 'vitest';
import { createApi } from '../../src/main/api';
import { openStore } from '../../src/main/store/store';
import { createProjectSession } from '../../src/main/project/session';
import { defaultProjectMeta } from '../../src/main/project/project-file';
import type { ProjectController } from '../../src/main/project/controller';
import { ENTITIES_FIELD, newItem, writeEntities } from '../../src/core/entities/model';
import { forkDb } from '../helpers/fixtures';

const box = { encrypt: (s: string) => Uint8Array.from(Buffer.from(s)), decrypt: (b: Uint8Array) => Buffer.from(b).toString() };

async function setup() {
  const db = forkDb();
  const api = createApi({ store: openStore(':memory:', box), openWorldDb: async () => db, openDevDb: async () => { throw new Error('x'); },
    fs: { writeFile: async () => {}, ensureDir: async () => {}, listDir: async () => [] }, now: () => new Date('2026-09-26T00:00:00Z'),
    session: createProjectSession(defaultProjectMeta('P', 'C:\\out')), projects: {} as ProjectController });
  const rec: any = await api.saveProfile({ name: 'w', role: 'world', host: 'h', port: 1, user: 'u', database: 'd', password: 'p' });
  await api.connect(rec.value.id);
  return { api, db };
}

describe('custom items through the API', () => {
  it('allocates item entries above the database and the project', async () => {
    const { api, db } = await setup();
    db.insert('item_template', { entry: '990100', name: 'Old' });
    expect(((await api.allocateIds('item', 1)) as any).value).toEqual([990101]);
    const opened: any = await api.newQuest();
    const aggregate = opened.value.aggregate;
    await api.putProjectEntities({ npcs: [], objects: [], items: [{ ...newItem(990105), name: 'Pearl' }] });
    await api.updateQuest(aggregate);
    expect(((await api.allocateIds('item', 1)) as any).value).toEqual([990106]);
  });
  it('finds, names and exports a new item, and counts it as existing for rewards', async () => {
    const { api } = await setup();
    const opened: any = await api.newQuest();
    const aggregate = opened.value.aggregate;
    aggregate.values['quest_template.LogTitle'] = 'Pearls';
    await api.putProjectEntities({ npcs: [], objects: [], items: [{ ...newItem(990110), name: 'Golden Pearl', displayId: 7040 }] });
    aggregate.values['quest_template.RewardItems'] = [{ item: 990110, amount: 1 }, { item: 0, amount: 0 }, { item: 0, amount: 0 }, { item: 0, amount: 0 }];
    await api.updateQuest(aggregate);
    expect(((await api.searchEntities('item', 'Pearl')) as any).value[0]).toMatchObject({ id: 990110, name: 'Golden Pearl', detail: 'new' });
    expect(((await api.lookupNames('item', [990110])) as any).value[990110]).toBe('Golden Pearl');
    const issues: any = await api.validate(aggregate.questId);
    expect(issues.value.filter((i: any) => i.severity === 'error')).toEqual([]);
    const out: any = await api.exportQuest(aggregate.questId);
    expect(out.value.projectSql).toMatch(/INSERT INTO `item_template` \(.*\) VALUES \(990110,/);
  });
  it('copies a look from an existing item and lists the columns for the advanced tab', async () => {
    const { api, db } = await setup();
    db.insert('item_template', { entry: '2589', name: 'Linen Cloth', displayid: '7426', class: '7', subclass: '5', InventoryType: '0' });
    expect(((await api.entityTemplate('item', 2589)) as any).value).toEqual({ name: 'Linen Cloth', displayId: 7426, itemClass: 7, subclass: 5, inventoryType: 0 });
    const cols: any = await api.itemColumns();
    expect(cols.value.map((c: any) => c.name)).toContain('holy_res');
  });
  it('links a new item that starts a quest to that quest', async () => {
    const { api } = await setup();
    const opened: any = await api.newQuest();
    const aggregate = opened.value.aggregate;
    await api.putProjectEntities({ npcs: [], objects: [], items: [{ ...newItem(990120), name: 'Torn Letter', startsQuest: aggregate.questId }] });
    await api.updateQuest(aggregate);
    const links: any = await api.questLinks([aggregate.questId]);
    expect(JSON.stringify(links.value)).toContain('990120');
  });
});

import { describe, expect, it } from 'vitest';
import { checkIds, checkNames } from '../../src/core/lore/names';
import type { ProjectNames } from '../../src/core/lore/types';
import { forkDb } from '../helpers/fixtures';

const noProject: ProjectNames = { creature: [], gameobject: [], item: [], quest: [] };

function world() {
  const db = forkDb();
  db.insert('creature_template', { entry: '1423', name: 'Stormwind Guard' });
  db.insert('creature_template', { entry: '1424', name: 'Stormwind Guard Captain' });
  db.insert('creature_template', { entry: '300', name: 'Grunt' });
  db.insert('quest_template', { ID: '33', LogTitle: 'Kobold Camp Cleanup' });
  return db;
}

describe('checkNames', () => {
  it('finds an exact name whatever its case, and lists longer names as similar', async () => {
    const [r] = await checkNames(world(), noProject, 'creature', ['stormwind guard']);
    expect(r!.exact).toEqual([{ id: 1423, name: 'Stormwind Guard', source: 'database' }]);
    expect(r!.similar.map((m) => m.id)).toEqual([1424]);
  });

  it('answers one result per name in order, and an empty one for a blank name', async () => {
    const out = await checkNames(world(), noProject, 'creature', ['Grunt', '  ', 'Nobody Here']);
    expect(out.map((r) => r.name)).toEqual(['Grunt', '', 'Nobody Here']);
    expect(out[0]!.exact).toHaveLength(1);
    expect(out[1]).toEqual({ name: '', exact: [], similar: [] });
    expect(out[2]).toEqual({ name: 'Nobody Here', exact: [], similar: [] });
  });

  it('does not count a number as a name: searching "300" does not find Grunt by its id', async () => {
    const [r] = await checkNames(world(), noProject, 'creature', ['300']);
    expect(r!.exact).toEqual([]);
    expect(r!.similar).toEqual([]);
  });

  it('includes the project\'s own NPCs and quests, marked as project', async () => {
    const project: ProjectNames = { ...noProject, creature: [{ id: 90001, name: 'Grunt' }, { id: 90002, name: 'Grunt Chief' }], quest: [{ id: 60000, name: 'Kobold Camp Cleanup' }] };
    const [grunt] = await checkNames(world(), project, 'creature', ['grunt']);
    expect(grunt!.exact.map((m) => `${m.source}:${m.id}`).sort()).toEqual(['database:300', 'project:90001']);
    expect(grunt!.similar).toEqual([{ id: 90002, name: 'Grunt Chief', source: 'project' }]);
    const [quest] = await checkNames(world(), project, 'quest', ['Kobold Camp Cleanup']);
    expect(quest!.exact.map((m) => m.source).sort()).toEqual(['database', 'project']);
  });

  it('lists at most 5 similar names', async () => {
    const db = world();
    for (let i = 0; i < 8; i++) db.insert('creature_template', { entry: String(2000 + i), name: `Guard ${i}` });
    const [r] = await checkNames(db, noProject, 'creature', ['Guard']);
    expect(r!.similar).toHaveLength(5);
  });
});

describe('checkIds', () => {
  it('says whether the database and the project have each id, and what they call it', async () => {
    const project: ProjectNames = { ...noProject, creature: [{ id: 90001, name: 'My Grunt' }, { id: 1423, name: 'Taken Over Guard' }] };
    const out = await checkIds(world(), project, 'creature', [1423, 90001, 99999]);
    expect(out).toEqual([
      { id: 1423, database: { name: 'Stormwind Guard' }, project: { name: 'Taken Over Guard' } },
      { id: 90001, database: null, project: { name: 'My Grunt' } },
      { id: 99999, database: null, project: null },
    ]);
  });

  it('checks quests too', async () => {
    const [r] = await checkIds(world(), noProject, 'quest', [33]);
    expect(r).toEqual({ id: 33, database: { name: 'Kobold Camp Cleanup' }, project: null });
  });
});

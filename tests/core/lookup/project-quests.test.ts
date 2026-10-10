import { describe, expect, it } from 'vitest';
import { overlayNpcQuests, overlayQuestSearch, type ProjectQuestFacts } from '../../../src/core/lookup/project-quests';

const quest = (id: number, title: string, over: Partial<ProjectQuestFacts> = {}): ProjectQuestFacts => ({ id, title, level: 10, starters: [], enders: [], ...over });

describe('overlayQuestSearch', () => {
  const rows = [{ id: 100, title: 'Old Title', level: 5 }, { id: 101, title: 'Wolves', level: 6 }];
  // The database matches the text before the overlay sees its rows
  const search = (text: string, project: ProjectQuestFacts[], limit = 50) =>
    overlayQuestSearch(rows.filter((r) => r.title.toLowerCase().includes(text.toLowerCase()) || String(r.id) === text), project, text, limit);
  it('shows a project quest in place of the database row with its id, under its current title', () => {
    const out = search('renamed', [quest(100, 'Renamed Quest')]);
    expect(out).toEqual([{ id: 100, title: 'Renamed Quest', level: 10, source: 'project' }]);
  });
  it('drops a database row the project retitled when the old title is searched', () => {
    expect(search('old', [quest(100, 'Renamed Quest')]).map((q) => q.id)).toEqual([]);
  });
  it('lists new project quests first and finds them by id', () => {
    const out = search('9000', [quest(9000, 'Brand New')]);
    expect(out).toEqual([{ id: 9000, title: 'Brand New', level: 10, source: 'project' }]);
    expect(search('wolves', [quest(9000, 'Wolves of the North')]).map((q) => q.id)).toEqual([9000, 101]);
  });
  it('leaves database rows unmarked and keeps to the limit', () => {
    expect(search('wolves', [])).toEqual([{ id: 101, title: 'Wolves', level: 6 }]);
    expect(search('wolves', [quest(9000, 'Wolves A'), quest(9001, 'Wolves B')], 2)).toHaveLength(2);
  });
});

describe('overlayNpcQuests', () => {
  const db = { starts: [{ id: 100, title: 'Old' }, { id: 101, title: 'Keep' }], ends: [{ id: 100, title: 'Old' }] };
  it('takes a quest the project moved off this NPC out, and puts one moved on in', () => {
    const out = overlayNpcQuests(
      db,
      [quest(100, 'Old', { starters: [{ kind: 'creature', entry: 999 }] }), quest(200, 'Moved here', { starters: [{ kind: 'creature', entry: 1423 }], enders: [{ kind: 'creature', entry: 1423 }] })],
      1423,
    );
    expect(out.starts).toEqual([{ id: 101, title: 'Keep' }, { id: 200, title: 'Moved here', source: 'project' }]);
    expect(out.ends).toEqual([{ id: 200, title: 'Moved here', source: 'project' }]);
  });
  it('shows a retitled quest under the project title, marked', () => {
    const out = overlayNpcQuests(db, [quest(101, 'New Name', { starters: [{ kind: 'creature', entry: 1423 }] })], 1423);
    expect(out.starts).toEqual([{ id: 100, title: 'Old' }, { id: 101, title: 'New Name', source: 'project' }]);
  });
  it('ignores an object that shares the entry number', () => {
    expect(overlayNpcQuests({ starts: [], ends: [] }, [quest(5, 'x', { starters: [{ kind: 'gameobject', entry: 1423 }] })], 1423).starts).toEqual([]);
  });
});

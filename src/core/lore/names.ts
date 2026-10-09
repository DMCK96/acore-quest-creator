import type { WorldDb } from '../db/world-db';
import type { IdCheck, NameCheck, NameKind, NameMatch, ProjectNames } from './types';

const SIMILAR_LIMIT = 5;
const SEARCH_LIMIT = 25;

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();
const contains = (name: string, needle: string): boolean => name.toLowerCase().includes(needle.toLowerCase());
const byId = (a: NameMatch, b: NameMatch): number => a.id - b.id;

/**
 * For each name, the things that already have it (exact, ignoring case) or one like it, in the
 * database and in the open project. Used before naming new content, so it does not clash.
 */
export async function checkNames(db: WorldDb, project: ProjectNames, kind: NameKind, names: string[]): Promise<NameCheck[]> {
  const out: NameCheck[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (name === '') {
      out.push({ name: '', exact: [], similar: [] });
      continue;
    }
    // A number searches by id, so a hit only counts when its own name has the text in it
    const hits = (await db.searchEntities(kind, name, SEARCH_LIMIT)).filter((h) => contains(h.name, name));
    const fromDb: NameMatch[] = hits.map((h) => ({ id: h.id, name: h.name, source: 'database' as const })).sort(byId);
    const fromProject: NameMatch[] = project[kind]
      .filter((p) => contains(p.name, name))
      .map((p) => ({ id: p.id, name: p.name, source: 'project' as const }))
      .sort(byId);
    const all = [...fromDb, ...fromProject];
    out.push({
      name,
      exact: all.filter((m) => same(m.name, name)),
      similar: all.filter((m) => !same(m.name, name)).slice(0, SIMILAR_LIMIT),
    });
  }
  return out;
}

/** For each id, whether the database and the open project have it, and what they call it. */
export async function checkIds(db: WorldDb, project: ProjectNames, kind: NameKind, ids: number[]): Promise<IdCheck[]> {
  const existing = await db.existingIds(kind, ids);
  const names = await db.lookupNames(kind, ids);
  return ids.map((id) => {
    const mine = project[kind].find((p) => p.id === id);
    return {
      id,
      database: existing.has(id) ? { name: names.get(id) ?? '' } : null,
      project: mine ? { name: mine.name } : null,
    };
  });
}

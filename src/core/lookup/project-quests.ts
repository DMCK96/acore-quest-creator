import type { QuestSummary } from '../db/world-db';

/** A quest of the open project as a lookup sees it: its current title, level and who starts and ends it */
export interface ProjectQuestFacts {
  id: number;
  title: string;
  level: number;
  starters: { kind: 'creature' | 'gameobject'; entry: number }[];
  enders: { kind: 'creature' | 'gameobject'; entry: number }[];
}

/** Marks what comes from the project (changed or new, not yet in the database) rather than the database */
export type FromProject = { source?: 'project' };

const matches = (quest: { id: number; title: string }, needle: string): boolean => quest.title.toLowerCase().includes(needle) || String(quest.id) === needle;

/**
 * Quest search with the project laid over the database: a project quest takes the place of the
 * database's row with its id (so its current title is what is searched and shown), and comes first.
 */
export function overlayQuestSearch(found: readonly QuestSummary[], project: readonly ProjectQuestFacts[], text: string, limit: number): (QuestSummary & FromProject)[] {
  const needle = text.trim().toLowerCase();
  if (needle === '') return found.slice(0, limit);
  const mine = project.filter((q) => matches(q, needle)).map((q): QuestSummary & FromProject => ({ id: q.id, title: q.title, level: q.level, source: 'project' }));
  const own = new Set(project.map((q) => q.id));
  return [...mine, ...found.filter((q) => !own.has(q.id))].slice(0, limit);
}

/**
 * The quests an NPC starts and ends with the project laid over the database: a quest the project has
 * is read from the project alone (it may have moved to or from this NPC), the rest from the database.
 */
export function overlayNpcQuests(
  db: { starts: { id: number; title: string }[]; ends: { id: number; title: string }[] },
  project: readonly ProjectQuestFacts[],
  entry: number,
): { starts: ({ id: number; title: string } & FromProject)[]; ends: ({ id: number; title: string } & FromProject)[] } {
  const own = new Set(project.map((q) => q.id));
  const merge = (rows: { id: number; title: string }[], role: 'starters' | 'enders') => {
    const mine = project.filter((q) => q[role].some((o) => o.kind === 'creature' && o.entry === entry)).map((q) => ({ id: q.id, title: q.title, source: 'project' as const }));
    return [...mine, ...rows.filter((r) => !own.has(r.id))].sort((a, b) => a.id - b.id);
  };
  return { starts: merge(db.starts, 'starters'), ends: merge(db.ends, 'enders') };
}

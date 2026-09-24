import type { RawRow } from '../db/types';
import type { WorldDb } from '../db/world-db';
import { rowsOrNone } from '../links/context';
import { taggedRows } from '../scripts/context';
import type { QuestEntities } from './model';

/** The tables new NPCs and objects are written to. */
export const ENTITY_TABLES = ['creature_template', 'creature_template_model', 'creature', 'gameobject_template', 'gameobject', 'page_text'] as const;

export const ENTITY_KEYS: Record<string, readonly string[]> = {
  creature_template: ['entry'],
  creature_template_model: ['CreatureID', 'Idx'],
  creature: ['guid'],
  gameobject_template: ['entry'],
  gameobject: ['guid'],
  page_text: ['ID'],
};

/**
 * What the database holds now for a quest's new entities: the template rows (so what quest
 * scripting set on them survives a re-insert) and the spawns this quest placed before (so removed
 * spawns are deleted).
 */
export interface EntityContext {
  /** `creature_template` rows of the new NPCs' entries: entry, AIName, gossip_menu_id, npcflag. */
  creatures: RawRow[];
  /** `gameobject_template` rows of the new objects' entries: entry, AIName. */
  gameobjects: RawRow[];
  taggedCreatureSpawns: RawRow[];
  taggedObjectSpawns: RawRow[];
}

export const EMPTY_ENTITY_CONTEXT: EntityContext = { creatures: [], gameobjects: [], taggedCreatureSpawns: [], taggedObjectSpawns: [] };

export async function readEntityContext(db: WorldDb, questId: number, entities: QuestEntities): Promise<EntityContext> {
  const npcEntries = entities.npcs.map((n) => String(n.entry));
  const objectEntries = entities.objects.map((o) => String(o.entry));
  const [creatures, gameobjects, taggedCreatureSpawns, taggedObjectSpawns] = await Promise.all([
    rowsOrNone(db, 'creature_template', { entry: npcEntries }),
    rowsOrNone(db, 'gameobject_template', { entry: objectEntries }),
    taggedRows(db, 'creature', 'Comment', questId),
    taggedRows(db, 'gameobject', 'Comment', questId),
  ]);
  const pick = (rows: readonly RawRow[], columns: readonly string[]): RawRow[] =>
    rows.map((row) => Object.fromEntries(columns.map((c) => [c, row[c] ?? null])));
  return {
    creatures: pick(creatures, ['entry', 'AIName', 'gossip_menu_id', 'npcflag']),
    gameobjects: pick(gameobjects, ['entry', 'AIName']),
    taggedCreatureSpawns: pick(taggedCreatureSpawns, ['guid', 'Comment']),
    taggedObjectSpawns: pick(taggedObjectSpawns, ['guid', 'Comment']),
  };
}

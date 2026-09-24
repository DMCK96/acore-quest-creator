import type { SchemaInfo } from '@core/db/types';
import type { WorldDb } from '@core/db/world-db';
import { importQuest } from '@core/import/importer';
import type { QuestAggregate, Snapshot } from '@core/model/aggregate';
import { registry } from '@core/registry';
import { loadSchema } from '@core/schema/load';
import { FakeWorldDb } from './fake-world-db';

/** Every table the registry knows, so the fixtures grow as more tables are registered. */
const registryTables = (): string[] => registry.tables.map((t) => t.table);

/**
 * Tables the registry never writes but the tool reads: name lookups, existence checks and the
 * quest-giver flag. A real world DB has them, so the fixture DB does too.
 */
const LOOKUP_TABLES = [
  'item_template', 'creature_template', 'gameobject_template', 'smart_scripts', 'areatrigger_scripts',
  // What quest scripting writes around the quest (slice C1).
  'creature_text', 'waypoints', 'gossip_menu', 'gossip_menu_option', 'npc_text', 'areatrigger',
  // Where new NPCs and objects are written (slice D).
  'creature_template_model', 'creature', 'gameobject', 'page_text',
] as const;

/** An empty in-memory world DB whose tables carry the fork's real DDL. */
export function forkDb(): FakeWorldDb {
  return FakeWorldDb.fromFork([...registryTables(), ...LOOKUP_TABLES]);
}

/** Loads the schema for every registry table, then imports one quest through the real importer. */
export async function importFixture(
  db: WorldDb,
  questId: number,
): Promise<{ schema: SchemaInfo; aggregate: QuestAggregate; snapshot: Snapshot }> {
  const schema = await loadSchema(db, registryTables());
  const { aggregate, snapshot } = await importQuest(db, schema, registry, questId);
  return { schema, aggregate, snapshot };
}

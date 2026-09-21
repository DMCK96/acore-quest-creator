import type { SchemaInfo } from '@core/db/types';
import type { WorldDb } from '@core/db/world-db';
import { importQuest } from '@core/import/importer';
import type { QuestAggregate, Snapshot } from '@core/model/aggregate';
import { registry } from '@core/registry';
import { loadSchema } from '@core/schema/load';
import { FakeWorldDb } from './fake-world-db';

/** Every table the registry knows, so the fixtures grow as more tables are registered. */
const registryTables = (): string[] => registry.tables.map((t) => t.table);

/** An empty in-memory world DB whose tables carry the fork's real DDL. */
export function forkDb(): FakeWorldDb {
  return FakeWorldDb.fromFork(registryTables());
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

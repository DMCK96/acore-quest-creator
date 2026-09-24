import { describe, expect, it } from 'vitest';
import { loadSchema } from '../../src/core/schema/load';
import { scriptStatements } from '../../src/core/scripts/statements';
import { compileEntities } from '../../src/core/entities/compile';
import { EMPTY_ENTITY_CONTEXT } from '../../src/core/entities/context';
import { newNpc, newSpawn } from '../../src/core/entities/model';
import { FakeWorldDb } from '../helpers/fake-world-db';

// Stock AzerothCore names a spawn's NPC `id1`; older forks (the CoA repack among them) name it `id`.
describe('the NPC a new spawn is of', () => {
  it('is written to whichever column the database has', async () => {
    const out = compileEntities({ questId: 60001, entities: { npcs: [{ ...newNpc(12000001), name: 'Hela', displayId: 1, spawns: [newSpawn(900)] }], objects: [] }, givers: [], context: EMPTY_ENTITY_CONTEXT });
    const schema = await loadSchema(FakeWorldDb.fromFork(['creature']), ['creature']);
    const older = { ...schema, tables: { ...schema.tables, creature: schema.tables.creature!.map((c) => (c.name === 'id1' ? { ...c, name: 'id' } : c)).filter((c) => c.name !== 'id2' && c.name !== 'id3') } };
    const row = (s: typeof schema) => scriptStatements(out, s).statements.find((st) => st.kind === 'insert' && st.table === 'creature') as { row: Record<string, string | null> };
    expect(row(schema).row.id1).toBe('12000001');
    expect(row(older).row.id).toBe('12000001');
  });
});

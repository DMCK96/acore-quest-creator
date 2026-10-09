import { describe, expect, it } from 'vitest';
import { compileEntities } from '../../src/core/entities/compile';
import { ENTITY_KEYS, ENTITY_TABLES, EMPTY_ENTITY_CONTEXT } from '../../src/core/entities/context';
import { scriptStatements } from '../../src/core/scripts/statements';
import { loadSchema } from '../../src/core/schema/load';
import { newNpc, newSpawn, type CustomNpc } from '../../src/core/entities/model';
import { FakeWorldDb } from '../helpers/fake-world-db';

const seller: CustomNpc = { ...newNpc(12000001), name: 'Hela', displayId: 1234, questGiver: true, gossip: true,
  spawns: [{ ...newSpawn(6000001) }],
  vendor: [{ item: 159, maxCount: 0, restockSecs: 900, extendedCost: 0 }, { item: 4540, maxCount: 5, restockSecs: 900, extendedCost: 1234 }] };
const plain: CustomNpc = { ...newNpc(12000002), name: 'Idle', displayId: 1234 };
const compile = (npcs: CustomNpc[]) => compileEntities({ entities: { npcs, objects: [], items: [] }, givers: [], context: EMPTY_ENTITY_CONTEXT });

describe('compiling a new NPC\'s vendor stock', () => {
  it('writes one npc_vendor row per item, in order, with unlimited stock never restocking', () => {
    expect(compile([seller]).inserts.npc_vendor).toEqual([
      { entry: '12000001', slot: '0', item: '159', maxcount: '0', incrtime: '0', ExtendedCost: '0' },
      { entry: '12000001', slot: '1', item: '4540', maxcount: '5', incrtime: '900', ExtendedCost: '1234' },
    ]);
  });

  it('sets the vendor bit with the quest giver and gossip bits, and not for a non-vendor', () => {
    expect(compile([seller]).inserts.creature_template![0]!.npcflag).toBe(String(1 | 2 | 128));
    expect(compile([plain]).inserts.creature_template![0]!.npcflag).toBe('0');
  });

  it('deletes every new NPC\'s stock by entry so a removed list is cleaned on re-export', () => {
    const out = compile([seller, plain]);
    expect(out.deletes.npc_vendor).toEqual([{ entry: '12000001' }, { entry: '12000002' }]);
    expect(out.inserts.npc_vendor).toHaveLength(2);
  });

  it('is a table the entities are written to, keyed by entry, item and extended cost', () => {
    expect(ENTITY_TABLES).toContain('npc_vendor');
    expect(ENTITY_KEYS.npc_vendor).toEqual(['entry', 'item', 'ExtendedCost']);
  });

  it('orders the statements: stock deleted before its template, inserted after it', async () => {
    const tables = ['creature_template', 'creature_template_model', 'npc_vendor'];
    const schema = await loadSchema(FakeWorldDb.fromFork(tables), tables);
    const { statements } = scriptStatements(compile([seller]), schema);
    const at = (kind: string, table: string) => statements.findIndex((s) => s.kind === kind && s.table === table);
    expect(at('delete', 'npc_vendor')).toBeGreaterThanOrEqual(0);
    expect(at('delete', 'npc_vendor')).toBeLessThan(at('delete', 'creature_template'));
    expect(at('insert', 'creature_template')).toBeLessThan(at('insert', 'npc_vendor'));
  });
});

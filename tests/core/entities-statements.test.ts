import { describe, expect, it } from 'vitest';
import { loadSchema } from '../../src/core/schema/load';
import { applyPatchInMemory } from '../../src/core/roundtrip/apply';
import { compileScenes } from '../../src/core/scripts/compile';
import { SCRIPT_KEYS, SCRIPT_TABLES, readScriptContext } from '../../src/core/scripts/context';
import { scriptStatements } from '../../src/core/scripts/statements';
import { compileEntities } from '../../src/core/entities/compile';
import { ENTITY_KEYS, ENTITY_TABLES, readEntityContext } from '../../src/core/entities/context';
import { newNpc, newSpawn, type QuestEntities } from '../../src/core/entities/model';
import type { QuestScene } from '../../src/core/scripts/model';
import type { PatchStatement } from '../../src/core/export/build-patch';
import { FakeWorldDb } from '../helpers/fake-world-db';

const Q = 60001;
const entities: QuestEntities = { npcs: [{ ...newNpc(12000001), name: 'Scout Hela', displayId: 1234, spawns: [newSpawn(6000001)] }], objects: [] };
const scene: QuestScene = { id: 's1', name: '', owner: { kind: 'creature', entry: 12000001 },
  trigger: { kind: 'gossipOption', text: 'Ready.', greeting: 'Hi.' }, gates: [], steps: [{ kind: 'closeGossip', waitMs: 0 }] };

describe('new NPC with a scene', () => {
  it('keeps its SmartAI setup and gossip menu across two exports', async () => {
    const tables = [...new Set([...SCRIPT_TABLES, ...ENTITY_TABLES])];
    const db = FakeWorldDb.fromFork(tables);
    const schema = await loadSchema(db, tables);
    const keys = { ...SCRIPT_KEYS, ...ENTITY_KEYS };
    const exportOnce = async (): Promise<PatchStatement[]> => {
      const ents = scriptStatements(compileEntities({ questId: Q, entities, givers: [], context: await readEntityContext(db, Q, entities) }), schema).statements;
      const scripts = scriptStatements(compileScenes({ questId: Q, scenes: [scene], objectives: [0, 0, 0, 0], context: await readScriptContext(db, Q, [scene]) }), schema).statements;
      const of = (list: PatchStatement[], kind: PatchStatement['kind']) => list.filter((s) => s.kind === kind);
      return [...of(ents, 'delete'), ...of(scripts, 'delete'), ...of(ents, 'insert'), ...of(scripts, 'set-flag'), ...of(scripts, 'update'), ...of(scripts, 'insert')];
    };
    const load = async () => Object.fromEntries(await Promise.all(tables.map(async (t) => [t, await db.selectRows(t, {})] as const)));
    const store = (state: Record<string, readonly Record<string, string | null>[]>) => {
      for (const [t, rows] of Object.entries(state)) { db.clear(t); for (const r of rows) db.insert(t, r); }
    };

    const once = applyPatchInMemory(await load(), await exportOnce(), keys);
    store(once);
    const template = once.creature_template!.find((r) => r.entry === '12000001')!;
    expect(template).toMatchObject({ AIName: 'SmartAI', npcflag: '1' });
    expect(template.gossip_menu_id).not.toBe('0');

    const twice = applyPatchInMemory(once, await exportOnce(), keys);
    expect(twice.creature_template).toEqual(once.creature_template);
    expect(twice.gossip_menu).toEqual(once.gossip_menu);
    expect(twice.gossip_menu_option).toEqual(once.gossip_menu_option);
    expect(twice.creature).toEqual(once.creature);
  });
});

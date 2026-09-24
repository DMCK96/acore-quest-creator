import { describe, expect, it } from 'vitest';
import { loadSchema } from '../../src/core/schema/load';
import { renderPatch } from '../../src/core/export/render-patch';
import { applyPatchInMemory } from '../../src/core/roundtrip/apply';
import { compileScenes } from '../../src/core/scripts/compile';
import { SCRIPT_KEYS, SCRIPT_TABLES, readScriptContext } from '../../src/core/scripts/context';
import { scriptStatements } from '../../src/core/scripts/statements';
import type { QuestScene } from '../../src/core/scripts/model';
import { FakeWorldDb } from '../helpers/fake-world-db';

const Q = 60001;
const scene: QuestScene = {
  id: 's1', name: '', owner: { kind: 'creature', entry: 299 }, trigger: { kind: 'spellHit', spellId: 0 },
  gates: [{ kind: 'quest', questId: 0, state: 'inLog', negate: false }],
  steps: [{ kind: 'say', text: 'Argh!', style: 'say', waitMs: 0 }, { kind: 'credit', objective: 1, group: false, waitMs: 1000 }],
};

async function world() {
  const db = FakeWorldDb.fromFork([...SCRIPT_TABLES]);
  db.insert('creature_template', { entry: '299', name: 'Wolf', npcflag: '0', gossip_menu_id: '0', AIName: '', ScriptName: '' });
  db.insert('smart_scripts', { entryorguid: '299', source_type: '0', id: '0', link: '0', event_type: '4', action_type: '11', comment: 'Wolf - On Aggro - Cast' });
  db.insert('creature_text', { CreatureID: '299', GroupID: '0', ID: '0', Text: 'Grr', comment: 'Wolf' });
  return db;
}

describe('script context and statements', () => {
  it('reads the rows on the owner and finds free ids around them', async () => {
    const db = await world();
    const context = await readScriptContext(db, Q, [scene]);
    expect(context.smartScripts).toHaveLength(1);
    expect(context.creatures[0]).toMatchObject({ entry: '299', AIName: '' });
    const compiled = compileScenes({ questId: Q, scenes: [scene], objectives: [299, 0, 0, 0], context });
    expect(compiled.inserts.smart_scripts![0]!.id).toBe('1');
    expect(compiled.inserts.creature_text![0]!.GroupID).toBe('1');
  });

  it('renders a patch that can be applied twice with the same result', async () => {
    const db = await world();
    const schema = await loadSchema(db, SCRIPT_TABLES);
    const exportOnce = async () => {
      const context = await readScriptContext(db, Q, [scene]);
      const compiled = compileScenes({ questId: Q, scenes: [scene], objectives: [299, 0, 0, 0], context });
      return scriptStatements(compiled, schema);
    };
    const first = await exportOnce();
    expect(first.missingTables).toEqual([]);
    const sql = renderPatch(first.statements, schema, { toolVersion: 't', questId: Q, date: 'd' });
    expect(sql).toContain("UPDATE `creature_template` SET `AIName` = 'SmartAI' WHERE `entry` = 299 AND `AIName` = '';");

    const tables = Object.fromEntries(await Promise.all(SCRIPT_TABLES.map(async (t) => [t, await db.selectRows(t, {})] as const)));
    const once = applyPatchInMemory(tables, first.statements, SCRIPT_KEYS);
    for (const [t, rows] of Object.entries(once)) { db.clear(t); for (const r of rows) db.insert(t, r); }

    const second = await exportOnce();
    const twice = applyPatchInMemory(once, second.statements, SCRIPT_KEYS);
    expect(twice.smart_scripts).toEqual(once.smart_scripts);
    expect(twice.creature_text).toEqual(once.creature_text);
    expect(twice.conditions).toEqual(once.conditions);
    expect(once.smart_scripts!.filter((r) => r.comment === 'Wolf - On Aggro - Cast')).toHaveLength(1);
  });

  it('reports tables the fork lacks instead of rendering statements for them', async () => {
    const db = FakeWorldDb.fromFork(['smart_scripts', 'creature_template']);
    db.insert('creature_template', { entry: '299', name: 'Wolf', npcflag: '0', gossip_menu_id: '0', AIName: '', ScriptName: '' });
    const schema = await loadSchema(db, SCRIPT_TABLES);
    const context = await readScriptContext(db, Q, [scene]);
    const compiled = compileScenes({ questId: Q, scenes: [scene], objectives: [299, 0, 0, 0], context });
    expect(scriptStatements(compiled, schema).missingTables).toEqual(['conditions', 'creature_text']);
  });
});

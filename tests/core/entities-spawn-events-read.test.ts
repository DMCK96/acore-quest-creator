import { describe, expect, it } from 'vitest';
import { npcSpawnGuids, spawnEventRows, spawnEventWarnings } from '../../src/core/entities/spawn-events-read';
import { EMPTY_WORLD } from '../../src/core/world/layer';
import { forkDb } from '../helpers/fixtures';

describe('reading an NPC\'s spawns and their events', () => {
  it('lists the spawn guids of an entry, and each guid\'s event rows', async () => {
    const db = forkDb();
    db.insert('creature', { guid: '80331', id1: '1423', map: '0' });
    db.insert('creature', { guid: '80330', id1: '1423', map: '0' });
    db.insert('creature', { guid: '5', id1: '99', map: '0' });
    db.insert('game_event_creature', { eventEntry: '12', guid: '80330' });
    db.insert('game_event_creature', { eventEntry: '-4', guid: '80330' });
    expect(await npcSpawnGuids(db, 1423)).toEqual([80330, 80331]);
    const rows = await spawnEventRows(db, [80330, 80331]);
    expect(rows.get(80331)).toEqual([]);
    expect(rows.get(80330)!.map((r) => r.eventEntry).sort()).toEqual(['-4', '12']);
  });

  it('reads nothing when the event table is missing', async () => {
    const db = forkDb();
    db.dropTable('game_event_creature');
    expect(await spawnEventRows(db, [1])).toEqual(new Map());
  });
});

describe('spawn event warnings', () => {
  it('warns about an event the database does not have and a spawn whose group follows an event', async () => {
    const db = forkDb();
    db.insert('game_event', { eventEntry: '12', description: 'Darkmoon Faire' });
    db.insert('pool_template', { entry: '500', max_limit: '1', description: 'Camp' });
    db.insert('pool_creature', { guid: '80330', pool_entry: '500', chance: '0', description: 'Camp' });
    db.insert('game_event_pool', { eventEntry: '12', pool_entry: '500' });
    const plan = [{ guid: 80330, entry: 1423, rule: { mode: 'during' as const, events: [12, 99] } }];
    expect(await spawnEventWarnings(db, plan, EMPTY_WORLD, new Map([[1423, 'Stormwind Guard']]))).toEqual([
      'Event 99 is not in game_event.',
      'Stormwind Guard (spawn 80330) follows events of its own and is in group Camp, which follows Darkmoon Faire. The server applies both.',
    ]);
  });

  it('follows a nested group up to the one that follows the event, and reads a layer group first', async () => {
    const db = forkDb();
    db.insert('game_event', { eventEntry: '12', description: 'Darkmoon Faire' });
    db.insert('pool_template', { entry: '501', max_limit: '1', description: '' });
    db.insert('pool_creature', { guid: '7', pool_entry: '501', chance: '0', description: '' });
    db.insert('pool_pool', { pool_id: '501', mother_pool: '600', chance: '0', description: '' });
    db.insert('game_event_pool', { eventEntry: '-12', pool_entry: '600' });
    const plan = [{ guid: 7, entry: 99, rule: { mode: 'except' as const, events: [12] } }];
    expect(await spawnEventWarnings(db, plan, EMPTY_WORLD, new Map())).toEqual([
      'NPC 99 (spawn 7) follows events of its own and is in group Pool 501, which follows Darkmoon Faire. The server applies both.',
    ]);
    const layer = { ...EMPTY_WORLD, groups: [{ id: 900001, name: 'Path 1', map: 0, maxActive: 1, event: { id: 12, during: true }, origin: { kind: 'new' as const },
      members: [{ type: 'spawn' as const, kind: 'npc' as const, guid: 7, entry: 99, chance: 0 }] }] };
    expect(await spawnEventWarnings(db, plan, layer, new Map())).toEqual([
      'NPC 99 (spawn 7) follows events of its own and is in group Path 1, which follows Darkmoon Faire. The server applies both.',
    ]);
  });

  it('reads the groups of many spawns in a few queries, not some per spawn', async () => {
    const db = forkDb();
    db.insert('game_event', { eventEntry: '12', description: 'Darkmoon Faire' });
    db.insert('pool_template', { entry: '500', max_limit: '1', description: 'Camp' });
    db.insert('game_event_pool', { eventEntry: '12', pool_entry: '500' });
    const plan = Array.from({ length: 50 }, (_, i) => {
      db.insert('pool_creature', { guid: String(1000 + i), pool_entry: '500', chance: '0', description: 'Camp' });
      return { guid: 1000 + i, entry: 1423, rule: { mode: 'during' as const, events: [12] } };
    });
    let reads = 0;
    const counting = { selectRows: (table: string, where: any) => { reads += 1; return db.selectRows(table, where); } };
    const warnings = await spawnEventWarnings(counting, plan, EMPTY_WORLD, new Map([[1423, 'Guard']]));
    expect(warnings).toHaveLength(50);
    expect(reads).toBeLessThanOrEqual(8);
  });

  it('says nothing for an always rule or a spawn in no group', async () => {
    const db = forkDb();
    expect(await spawnEventWarnings(db, [{ guid: 1, entry: 1, rule: null }], EMPTY_WORLD, new Map())).toEqual([]);
  });
});

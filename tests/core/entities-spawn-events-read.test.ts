import { describe, expect, it } from 'vitest';
import { npcSpawnGuids, spawnEventRows } from '../../src/core/entities/spawn-events-read';
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

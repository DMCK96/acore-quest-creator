import { describe, expect, it } from 'vitest';
import { toSpawnDot } from '../../src/core/db/spawns';

const row = { guid: '5', entry: '1423', name: 'Guard', map: '0', position_x: '1', position_y: '2', position_z: '3' };

describe('a spawn row as a dot', () => {
  it('has no event unless the row names one that appears the spawn (a positive entry)', () => {
    expect(toSpawnDot('creature', row)).toEqual({ kind: 'creature', guid: 5, entry: 1423, name: 'Guard', map: 0, x: 1, y: 2, z: 3 });
    expect(toSpawnDot('creature', { ...row, event_entry: null, event_name: null })).not.toHaveProperty('event');
    expect(toSpawnDot('creature', { ...row, event_entry: '12', event_name: "Hallow's End" }).event).toEqual({ id: 12, name: "Hallow's End" });
    expect(toSpawnDot('gameobject', { ...row, event_entry: '12', event_name: null }).event).toEqual({ id: 12, name: '' });
  });
});

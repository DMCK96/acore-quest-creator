import { describe, expect, it } from 'vitest';
import { giverSummary } from '../../src/core/modules/summaries';
import { newNpc, newObject } from '../../src/core/entities/model';

const store = { npcs: [{ ...newNpc(12000005), name: 'Captain Vessa' }, newNpc(12000006)], objects: [{ ...newObject(9100001), name: 'Notice Board' }], items: [] };
const values = {
  creature_queststarter: [{ id: 12000005 }],
  creature_questender: [{ id: 12000006 }],
  gameobject_queststarter: [{ id: 9100001 }],
} as never;

describe('module summaries name this quest\'s own NPCs and objects', () => {
  it('uses their names as they are now, before any lookup', () => {
    expect(giverSummary(values, () => undefined, store)).toEqual(['Starts: Captain Vessa, Notice Board', 'Ends: New NPC 12000006']);
  });
  it('prefers them over a stale looked-up name', () => {
    expect(giverSummary(values, (kind, id) => (kind === 'creature' && id === 12000005 ? '#12000005' : undefined), store)[0]).toBe('Starts: Captain Vessa, Notice Board');
  });
});

import { describe, expect, it } from 'vitest';
import { isSpiritNpc, seenByColumns, seenByOf } from '../../src/core/entities/visibility';
import { newNpc } from '../../src/core/entities/model';

describe('who sees an NPC', () => {
  it('reads dead-only first, then living and dead, else living', () => {
    expect(seenByOf({ flags_extra: '1024', type_flags: '2' })).toBe('dead');
    expect(seenByOf({ flags_extra: '0', type_flags: '2' })).toBe('both');
    expect(seenByOf({ flags_extra: '64', type_flags: '0' })).toBe('living');
    expect(seenByOf({})).toBe('living');
  });

  it('a spirit healer or guide is dead-only whatever its flags say', () => {
    expect(seenByOf({ npcflag: '16384', flags_extra: '0' })).toBe('dead');
    expect(seenByOf({ npcflag: '32769' })).toBe('dead');
  });

  it('sets its own bit, clears the other, and keeps every other bit', () => {
    expect(seenByColumns('dead', { flags_extra: '64', type_flags: '6' })).toEqual({ flags_extra: '1088', type_flags: '4' });
    expect(seenByColumns('both', { flags_extra: '1088', type_flags: '4' })).toEqual({ flags_extra: '64', type_flags: '6' });
    expect(seenByColumns('living', { flags_extra: '1088', type_flags: '6' })).toEqual({ flags_extra: '64', type_flags: '4' });
    expect(seenByColumns('living', {})).toEqual({ flags_extra: '0', type_flags: '0' });
  });

  it('knows a spirit healer by its original npcflag', () => {
    const healer = { ...newNpc(6491), origin: { kind: 'existing' as const, original: { creature_template: [{ entry: '6491', npcflag: '16384' }] }, sharedLoot: 0, spawnCount: 1, locked: [] } };
    expect(isSpiritNpc(healer)).toBe(true);
    expect(isSpiritNpc(newNpc(1))).toBe(false);
  });
});

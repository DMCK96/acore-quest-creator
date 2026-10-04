import { describe, expect, it } from 'vitest';
import { IDLE, MOVEMENT_TYPE, movementOfRow, sameMovement } from '../../../src/core/world/movement';

describe('an NPC spawn\'s movement', () => {
  it('reads a row: wander only counts when it roams, a path only when it walks one', () => {
    expect(movementOfRow({ MovementType: '1', wander_distance: '5', path_id: '0' })).toEqual({ type: 'wander', wander: 5, pathId: null });
    expect(movementOfRow({ MovementType: '0', wander_distance: '5', path_id: null })).toEqual(IDLE);
    expect(movementOfRow({ MovementType: '2', wander_distance: '0', path_id: '801' })).toEqual({ type: 'path', wander: 0, pathId: 801 });
    // A path id with an idle movement type is kept: the spawn has the row, the server just does not walk it
    expect(movementOfRow({ MovementType: '0', wander_distance: '0', path_id: '801' })).toEqual({ type: 'idle', wander: 0, pathId: 801 });
  });

  it('has the server\'s movement type numbers', () => {
    expect(MOVEMENT_TYPE).toEqual({ idle: 0, wander: 1, path: 2 });
  });

  it('compares by value', () => {
    expect(sameMovement({ type: 'wander', wander: 5, pathId: null }, { type: 'wander', wander: 5, pathId: null })).toBe(true);
    expect(sameMovement(IDLE, { ...IDLE, pathId: 0 })).toBe(false);
  });
});

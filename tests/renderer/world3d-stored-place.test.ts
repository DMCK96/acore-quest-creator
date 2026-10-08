import { describe, expect, it } from 'vitest';
import { EMPTY_WORLD, type Placement, type WorldLayer } from '../../src/core/world/layer';
import { storedPlaceAfter } from '../../src/renderer/world3d/stored-place';

const at = (x: number): Placement => ({ x, y: 2, z: 3, orientation: 0, rotation: null });
const moved = (guid: number, original: number, current: number, kind: 'creature' | 'gameobject' = 'creature'): WorldLayer['spawns'][number] => ({
  kind, guid, entry: 1, name: 'n', map: 0, original: at(original), current: at(current),
});
const layer = (over: Partial<WorldLayer>): WorldLayer => ({ ...EMPTY_WORLD, ...over });

describe('where a selected spawn is stored after the layer changes under it', () => {
  it('is its edited place while the layer holds the edit (a redo, or an undo of a later move)', () => {
    expect(storedPlaceAfter(layer({ spawns: [moved(7, 1, 5)] }), layer({ spawns: [moved(7, 1, 3)] }), 'creature', 7)).toEqual({ x: 3, y: 2, z: 3 });
  });
  it('is the database\'s place once the layer lets go of the edit (an undo of the first move, a revert)', () => {
    expect(storedPlaceAfter(layer({ spawns: [moved(7, 1, 5)] }), EMPTY_WORLD, 'creature', 7)).toEqual({ x: 1, y: 2, z: 3 });
  });
  it('is a placed spawn\'s place in the layer', () => {
    const added = { kind: 'creature' as const, guid: 9, entry: 1, name: 'n', map: 0, placement: at(4), look: {} as never };
    expect(storedPlaceAfter(EMPTY_WORLD, layer({ added: [added] }), 'creature', 9)).toEqual({ x: 4, y: 2, z: 3 });
  });
  it('tells objects from NPCs, and says nothing of a spawn neither layer edits', () => {
    expect(storedPlaceAfter(layer({ spawns: [moved(7, 1, 5, 'gameobject')] }), EMPTY_WORLD, 'creature', 7)).toBeNull();
    expect(storedPlaceAfter(layer({ spawns: [moved(7, 1, 5, 'gameobject')] }), EMPTY_WORLD, 'object', 7)).toEqual({ x: 1, y: 2, z: 3 });
    expect(storedPlaceAfter(EMPTY_WORLD, EMPTY_WORLD, 'creature', 7)).toBeNull();
  });
});

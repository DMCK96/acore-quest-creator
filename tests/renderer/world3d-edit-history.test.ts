import { describe, expect, it } from 'vitest';
import { createHistory } from '../../src/renderer/world3d/scene/edit/history';
import type { SpawnEdit } from '../../src/renderer/world3d/edits';

const place = (x: number): SpawnEdit => ({ kind: 'place', spawn: { kind: 'creature', guid: 1, entry: 1, own: false }, to: { x, y: 0, z: 0, orientation: 0, rotation: null } });

describe('the 3D view\'s undo history', () => {
  it('undo re-emits the earlier whole state, redo the later', () => {
    const h = createHistory();
    h.push(place(1), place(2));
    h.push(place(2), place(3));
    expect(h.undo()).toEqual(place(2));
    expect(h.undo()).toEqual(place(1));
    expect(h.undo()).toBeNull();
    expect(h.redo()).toEqual(place(2));
  });

  it('undo after the world entry was reverted elsewhere still gives the earlier whole placement', () => {
    const h = createHistory();
    h.push(place(1), place(2));
    // The modal reverted the spawn to x = 1 meanwhile; undo must not compute a delta from x = 2
    expect(h.undo()).toEqual(place(1));
    expect(h.redo()).toEqual(place(2));
  });

  it('a new edit drops what could be redone, and clear empties it', () => {
    const h = createHistory();
    h.push(place(1), place(2));
    h.undo();
    h.push(place(1), place(5));
    expect(h.redo()).toBeNull();
    h.clear();
    expect(h.undo()).toBeNull();
  });
});

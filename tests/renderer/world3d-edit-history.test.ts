import { describe, expect, it } from 'vitest';
import { createHistory } from '../../src/renderer/world3d/scene/edit/history';
import type { SpawnEdit } from '../../src/renderer/world3d/edits';

const place = (guid: number, x: number): SpawnEdit => ({ kind: 'place', spawn: { kind: 'creature', guid, entry: 1, own: false }, to: { x, y: 0, z: 0, orientation: 0, rotation: null } });

describe('the 3D view\'s undo history', () => {
  it('undo re-emits the earlier whole state, redo the later', () => {
    const h = createHistory();
    h.push([place(1, 1)], [place(1, 2)]);
    h.push([place(1, 2)], [place(1, 3)]);
    expect(h.undo()).toEqual([place(1, 2)]);
    expect(h.undo()).toEqual([place(1, 1)]);
    expect(h.undo()).toBeNull();
    expect(h.redo()).toEqual([place(1, 2)]);
  });

  it('one step holds every edit of a gesture, undone and redone together', () => {
    const h = createHistory();
    h.push([place(1, 1), place(2, 10)], [place(1, 2), place(2, 20)]);
    expect(h.undo()).toEqual([place(1, 1), place(2, 10)]);
    expect(h.undo()).toBeNull();
    expect(h.redo()).toEqual([place(1, 2), place(2, 20)]);
  });

  it('undo after the world entry was reverted elsewhere still gives the earlier whole placement', () => {
    const h = createHistory();
    h.push([place(1, 1)], [place(1, 2)]);
    expect(h.undo()).toEqual([place(1, 1)]);
    expect(h.redo()).toEqual([place(1, 2)]);
  });

  it('a new edit drops what could be redone, and clear empties it', () => {
    const h = createHistory();
    h.push([place(1, 1)], [place(1, 2)]);
    h.undo();
    h.push([place(1, 1)], [place(1, 5)]);
    expect(h.redo()).toBeNull();
    h.clear();
    expect(h.undo()).toBeNull();
  });
});

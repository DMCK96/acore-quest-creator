import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PlacementCopies } from '../../src/renderer/world3d/scene/wmo/placement-copies';

const object = () => new THREE.Group();

describe('a building placed once for each tile it touches', () => {
  it('draws the first copy and hides the others', () => {
    const copies = new PlacementCopies();
    const [a, b, c] = [object(), object(), object()];
    copies.add('1:keep', 10, a);
    copies.add('1:keep', 11, b);
    copies.add('1:keep', 12, c);
    expect([a.visible, b.visible, c.visible]).toEqual([true, false, false]);
  });

  it('leaves buildings with different keys alone', () => {
    const copies = new PlacementCopies();
    const [a, b] = [object(), object()];
    copies.add('1:keep', 10, a);
    copies.add('2:keep', 11, b);
    expect([a.visible, b.visible]).toEqual([true, true]);
  });

  it('draws another copy when the area of the drawn one goes', () => {
    const copies = new PlacementCopies();
    const [a, b, c] = [object(), object(), object()];
    copies.add('1:keep', 10, a);
    copies.add('1:keep', 11, b);
    copies.add('1:keep', 12, c);
    copies.removeArea(10);
    expect([b.visible, c.visible]).toEqual([true, false]);
    copies.removeArea(11);
    expect(c.visible).toBe(true);
  });

  it('keeps the drawn copy when the area of a hidden one goes', () => {
    const copies = new PlacementCopies();
    const [a, b] = [object(), object()];
    copies.add('1:keep', 10, a);
    copies.add('1:keep', 11, b);
    copies.removeArea(11);
    expect(a.visible).toBe(true);
  });

  it('forgets a building whose every area went, so it can be placed again drawn', () => {
    const copies = new PlacementCopies();
    const a = object();
    copies.add('1:keep', 10, a);
    copies.removeArea(10);
    const again = object();
    copies.add('1:keep', 10, again);
    expect(again.visible).toBe(true);
  });

  it('takes an area that placed several buildings, and one that is not known, without trouble', () => {
    const copies = new PlacementCopies();
    const [a, b, c] = [object(), object(), object()];
    copies.add('1:keep', 10, a);
    copies.add('2:keep', 10, b);
    copies.add('1:keep', 11, c);
    copies.removeArea(10);
    expect(c.visible).toBe(true);
    expect(() => copies.removeArea(99)).not.toThrow();
  });
});

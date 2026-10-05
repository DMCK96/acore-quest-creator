import { describe, expect, it } from 'vitest';
import { popPlace, pushPlace } from '../../src/renderer/world3d/camera-history';

const at = (x: number, map = 0) => ({ map, x, y: 0, z: 0, label: `P${x}` });

describe('the camera back stack', () => {
  it('pushes places and pops the last first', () => {
    const stack = pushPlace(pushPlace([], at(1)), at(2));
    const one = popPlace(stack);
    expect(one.place).toEqual(at(2));
    expect(popPlace(one.stack).place).toEqual(at(1));
    expect(popPlace([]).place).toBeNull();
  });

  it('keeps the same place twice in a row once, and at most 20', () => {
    expect(pushPlace(pushPlace([], at(1)), at(1))).toHaveLength(1);
    let stack: ReturnType<typeof pushPlace> = [];
    for (let i = 0; i < 25; i += 1) stack = pushPlace(stack, at(i));
    expect(stack).toHaveLength(20);
    expect(stack[0]).toEqual(at(5));
  });

  it('a place on another map is a different place', () => {
    expect(pushPlace(pushPlace([], at(1, 0)), at(1, 1))).toHaveLength(2);
  });
});

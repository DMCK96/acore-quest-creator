import { describe, expect, it, vi } from 'vitest';
import { decodePart, dropToRequest, encodePart, groundOverDrag } from '../../src/renderer/world3d/chain-drop';

describe('chain drop', () => {
  it('round-trips a part', () => {
    expect(decodePart(encodePart({ kind: 'creature', entry: 1234 }))).toEqual({ kind: 'creature', entry: 1234 });
  });

  it.each(['', '{', 'null', '{"kind":"item","entry":1}', '{"kind":"creature","entry":"x"}', '{"kind":"creature","entry":-1}'])(
    'rejects %j', (bad) => expect(decodePart(bad)).toBeNull());

  it('turns a drop on the ground into a placement facing the camera', () => {
    const request = dropToRequest(encodePart({ kind: 'gameobject', entry: 55 }), { x: 10, y: 0, z: 2 }, { x: 10, y: 5 });
    expect(request?.target).toEqual({ kind: 'object', entry: 55 });
    expect(request?.at).toMatchObject({ x: 10, y: 0, z: 2 });
  });

  it('ignores a drop on the sky', () => {
    expect(dropToRequest(encodePart({ kind: 'creature', entry: 1 }), null, { x: 0, y: 0 })).toBeNull();
  });

  // Every dragover would cast a ray through the whole world: the answer is kept while the pointer stays put
  describe('the ground under a drag', () => {
    const make = () => {
      const frames: (() => void)[] = [];
      const groundAt = vi.fn((at: { x: number; y: number }) => ({ x: at.x, y: at.y, z: 0 }));
      const ground = groundOverDrag(groundAt, (run) => frames.push(run));
      return { ground, groundAt, nextFrame: () => frames.splice(0).forEach((run) => run()) };
    };

    it('asks again only once the pointer has moved more than a few pixels', () => {
      const { ground, groundAt, nextFrame } = make();
      expect(ground.at({ x: 100, y: 100 })).toEqual({ x: 100, y: 100, z: 0 });
      nextFrame();
      ground.at({ x: 102, y: 101 });
      nextFrame();
      expect(groundAt).toHaveBeenCalledTimes(1);
      expect(ground.at({ x: 110, y: 100 })).toEqual({ x: 110, y: 100, z: 0 });
      expect(groundAt).toHaveBeenCalledTimes(2);
    });

    it('asks at most once a frame, however far the pointer moves', () => {
      const { ground, groundAt, nextFrame } = make();
      ground.at({ x: 0, y: 0 });
      ground.at({ x: 50, y: 0 });
      ground.at({ x: 100, y: 0 });
      expect(groundAt).toHaveBeenCalledTimes(1);
      nextFrame();
      expect(ground.at({ x: 100, y: 0 })).toEqual({ x: 100, y: 0, z: 0 });
      expect(groundAt).toHaveBeenCalledTimes(2);
    });

    it('starts afresh after a reset (the drag left or dropped)', () => {
      const { ground, groundAt } = make();
      ground.at({ x: 0, y: 0 });
      ground.reset();
      ground.at({ x: 0, y: 0 });
      expect(groundAt).toHaveBeenCalledTimes(2);
    });
  });
});

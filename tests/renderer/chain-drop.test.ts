import { describe, expect, it } from 'vitest';
import { decodePart, dropToRequest, encodePart } from '../../src/renderer/world3d/chain-drop';

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
});

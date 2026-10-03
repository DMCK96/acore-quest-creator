// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readAttachments } from '../../src/renderer/world3d/scene/model/attachments';

const m2With = (attachments: { id: number; bone: number; position: [number, number, number] }[]) => {
  const at = 0x200;
  const buffer = new ArrayBuffer(at + attachments.length * 40);
  const view = new DataView(buffer);
  view.setUint32(0xf0, attachments.length, true);
  view.setUint32(0xf4, at, true);
  attachments.forEach((a, i) => {
    const o = at + i * 40;
    view.setUint32(o, a.id, true);
    view.setUint16(o + 4, a.bone, true);
    a.position.forEach((v, k) => view.setFloat32(o + 8 + k * 4, v, true));
  });
  return buffer;
};

describe('a model\'s attachment points', () => {
  it('are read from the array at 0xF0, 40 bytes each', () => {
    const out = readAttachments(m2With([{ id: 1, bone: 12, position: [0.5, -0.25, 1] }, { id: 2, bone: 13, position: [0, 0.25, 1] }]));
    expect(out).toEqual([{ id: 1, bone: 12, position: [0.5, -0.25, 1] }, { id: 2, bone: 13, position: [0, 0.25, 1] }]);
  });

  it('are none when the model has none, or the array runs past the end of the file', () => {
    expect(readAttachments(m2With([]))).toEqual([]);
    const broken = m2With([{ id: 1, bone: 0, position: [0, 0, 0] }]);
    new DataView(broken).setUint32(0xf0, 99, true);
    expect(readAttachments(broken)).toEqual([]);
    expect(readAttachments(new ArrayBuffer(16))).toEqual([]);
  });
});

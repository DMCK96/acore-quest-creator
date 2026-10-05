import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import DoodadBatch from '../../src/renderer/world3d/scene/map/DoodadBatch';

// A doodad model as the batch sees it: geometry with groups, its materials, skinned or not
const doodad = (opts: { skinned?: boolean; blend?: number; transparent?: boolean; at?: [number, number, number] } = {}) => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
  geometry.setIndex([0, 1, 2]);
  geometry.addGroup(0, 3, 0);
  const material: any = new THREE.RawShaderMaterial();
  material.transparent = opts.transparent ?? false;
  material.blend = opts.blend ?? 0;
  material.prepareMaterial = vi.fn();
  const model: any = new THREE.Mesh(geometry, [material]);
  model.skinned = opts.skinned ?? false;
  model.position.set(...(opts.at ?? [0, 0, 0]));
  model.updateMatrixWorld();
  return model;
};

describe('drawing many copies of a doodad in one call', () => {
  it('takes only doodads whose bones never move and that have nothing blended, by how the model file blends', () => {
    expect(DoodadBatch.fits(doodad())).toBe(true);
    // Alpha-keyed (cut-out leaves, fences) draw unsorted, so they batch too, even while fading made them blend
    expect(DoodadBatch.fits(doodad({ blend: 1, transparent: true }))).toBe(true);
    expect(DoodadBatch.fits(doodad({ blend: 2 }))).toBe(false);
    expect(DoodadBatch.fits(doodad({ skinned: true }))).toBe(false);
  });

  it('draws with the template\'s vertices and materials, compiled for copies', () => {
    const template = doodad();
    const batch = new DoodadBatch(template);
    expect(batch.geometry.getAttribute('position')).toBe(template.geometry.getAttribute('position'));
    expect(batch.geometry.groups).toEqual(template.geometry.groups);
    expect((batch.material as any)[0].defines.USE_INSTANCING).toBe(1);
  });

  it('puts in each copy where it stands, growing as needed, and is hidden with none', () => {
    const batch = new DoodadBatch(doodad());
    batch.begin();
    for (let i = 0; i < 40; i++) batch.addCopy(doodad({ at: [i, 0, 0] }));
    batch.finish();
    expect(batch.count).toBe(40);
    expect(batch.visible).toBe(true);
    const at = new THREE.Matrix4();
    batch.getMatrixAt(39, at);
    expect(new THREE.Vector3().setFromMatrixPosition(at).x).toBe(39);
    batch.begin();
    batch.finish();
    expect(batch.visible).toBe(false);
  });

  it('gives each material the template\'s animation state before it draws', () => {
    const template = doodad();
    const batch = new DoodadBatch(template);
    const material = (batch.material as any)[0];
    batch.onBeforeRender({} as any, {} as any, {} as any, batch.geometry, material);
    expect(material.prepareMaterial).toHaveBeenCalledWith(template);
  });
});

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ViewChange } from '../../src/renderer/world3d/scene/view-change';

const frustumOf = (camera: THREE.PerspectiveCamera) => {
  camera.updateMatrixWorld();
  return new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
};

describe('telling whether the view changed', () => {
  it('says so the first time, then only once the camera moves or turns, or something marks it changed', () => {
    const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 1000);
    const change = new ViewChange();
    expect(change.check(camera.position, frustumOf(camera))).toBe(true);
    expect(change.check(camera.position, frustumOf(camera))).toBe(false);
    camera.position.x = 1;
    expect(change.check(camera.position, frustumOf(camera))).toBe(true);
    expect(change.check(camera.position, frustumOf(camera))).toBe(false);
    camera.rotation.y = 0.2;
    expect(change.check(camera.position, frustumOf(camera))).toBe(true);
    change.mark();
    expect(change.check(camera.position, frustumOf(camera))).toBe(true);
    expect(change.check(camera.position, frustumOf(camera))).toBe(false);
  });
});

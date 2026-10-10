// @vitest-environment jsdom
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { spawnBounds, spawnLocalBounds } from '../../src/renderer/world3d/scene/spawn/SpawnManager';

/** A spawn turned 45° about Z, holding a 4 x 2 x 2 box centred on itself */
function turnedSpawn(): THREE.Object3D {
  const spawn = new THREE.Group();
  spawn.position.set(10, 20, 5);
  spawn.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 4);
  spawn.add(new THREE.Mesh(new THREE.BoxGeometry(4, 2, 2), new THREE.MeshBasicMaterial()));
  spawn.updateMatrixWorld(true);
  return spawn;
}

describe('a spawn\'s bounds', () => {
  it('in its own frame are as big as the model, however it is turned', () => {
    const size = spawnLocalBounds(turnedSpawn(), new THREE.Box3()).getSize(new THREE.Vector3());
    expect(size.toArray()).toEqual([4, 2, 2]);
  });

  it('in the world are the wider box round the turned model', () => {
    const size = spawnBounds(turnedSpawn(), new THREE.Box3()).getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(3 * Math.SQRT2, 6);
  });

  it('in its own frame follow a part that is moved inside the spawn', () => {
    const spawn = turnedSpawn();
    spawn.children[0]!.position.set(6, 0, 0);
    spawn.updateMatrixWorld(true);
    expect(spawnLocalBounds(spawn, new THREE.Box3()).getCenter(new THREE.Vector3()).x).toBeCloseTo(6, 6);
  });
});

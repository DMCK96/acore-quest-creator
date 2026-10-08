import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FloorGrid } from '../../src/renderer/world3d/scene/spawn/floor-index';
import { floorHeightBelow } from '../../src/renderer/world3d/scene/spawn/ground-probe';

/** A tiny deterministic generator, so a failure can be replayed */
const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

/** A bumpy sheet of `n` by `n` cells, facing up, with a second sheet above it (a roof) */
function sheets(n: number, size: number, indexed = true): THREE.BufferGeometry {
  const random = rng(7);
  const positions: number[] = [];
  const indices: number[] = [];
  for (const [lift, jitter] of [[0, 0.6], [4, 0.3]] as const) {
    const base = positions.length / 3;
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) positions.push((i / n) * size, (j / n) * size, lift + random() * jitter);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const a = base + i * (n + 1) + j;
        const b = a + 1;
        const c = a + n + 1;
        const d = c + 1;
        // Counter-clockwise seen from above
        indices.push(a, c, b, b, c, d);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return indexed ? geometry : geometry.toNonIndexed();
}

/** What three.js itself finds for a downward ray, as the old ground lookup did */
function brute(mesh: THREE.Mesh, x: number, y: number, fromZ: number, distance: number): number | null {
  const ray = new THREE.Raycaster(new THREE.Vector3(x, y, fromZ), new THREE.Vector3(0, 0, -1), 0, distance);
  return ray.intersectObject(mesh, false)[0]?.point.z ?? null;
}

const close = (a: number | null, b: number | null) => (a === null || b === null ? a === b : Math.abs(a - b) < 1e-4);

describe('the floor under a point', () => {
  it('finds the same height three.js does, over a placed double-sided building', () => {
    const mesh = new THREE.Mesh(sheets(12, 40), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    mesh.position.set(100, -50, 30);
    mesh.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), 1.1);
    mesh.updateMatrixWorld(true);
    const random = rng(3);
    let hits = 0;
    // Round the building's middle, which is (20, 20) in its own space
    const middle = new THREE.Vector3(20, 20, 0).applyMatrix4(mesh.matrixWorld);
    for (let i = 0; i < 400; i++) {
      const x = middle.x + (random() - 0.5) * 30;
      const y = middle.y + (random() - 0.5) * 30;
      const fromZ = 30 + random() * 7;
      const distance = random() < 0.5 ? 1.5 : 6;
      const expected = brute(mesh, x, y, fromZ, distance);
      if (expected !== null) hits++;
      expect(close(floorHeightBelow([mesh], x, y, fromZ, distance), expected), `${x} ${y} ${fromZ} ${distance}`).toBe(true);
    }
    expect(hits).toBeGreaterThan(100);
  });

  it('ignores faces seen from behind on a one-sided floor, as three.js does, and takes them on a two-sided one', () => {
    const geometry = sheets(6, 20);
    const front = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.FrontSide }));
    const upsideDown = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.FrontSide }));
    upsideDown.rotation.x = Math.PI;
    upsideDown.updateMatrixWorld(true);
    const random = rng(11);
    for (const mesh of [front, upsideDown]) {
      for (let i = 0; i < 200; i++) {
        const x = (random() - 0.2) * 30;
        const y = (random() - 0.2) * 30;
        const fromZ = (mesh === front ? 0 : -4) + random() * 6;
        expect(close(floorHeightBelow([mesh], x, y, fromZ, 8), brute(mesh, x, y, fromZ, 8))).toBe(true);
      }
    }
  });

  it('answers for a tilted mesh and a non-indexed one by the same rule, through three.js', () => {
    const tilted = new THREE.Mesh(sheets(5, 20), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    tilted.rotation.x = 0.4;
    tilted.updateMatrixWorld(true);
    const flat = new THREE.Mesh(sheets(5, 20, false), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    const random = rng(5);
    for (const mesh of [tilted, flat]) {
      for (let i = 0; i < 100; i++) {
        const x = random() * 20;
        const y = random() * 20;
        const fromZ = 3 + random() * 3;
        expect(close(floorHeightBelow([mesh], x, y, fromZ, 8), brute(mesh, x, y, fromZ, 8))).toBe(true);
      }
    }
  });

  it('takes the highest of several floors, in a group or beside one another, and null where there is none', () => {
    const low = new THREE.Mesh(sheets(2, 10), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    const high = new THREE.Mesh(sheets(2, 10), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    high.position.z = 10;
    const group = new THREE.Group();
    group.add(high);
    group.updateMatrixWorld(true);
    const expected = Math.max(brute(low, 5, 5, 20, 40) ?? -Infinity, brute(high, 5, 5, 20, 40) ?? -Infinity);
    expect(floorHeightBelow([low, group], 5, 5, 20, 40)).toBeCloseTo(expected, 4);
    expect(floorHeightBelow([low, group], 500, 500, 20, 40)).toBeNull();
    expect(floorHeightBelow([], 5, 5, 20, 40)).toBeNull();
  });

  it('sees a floor added to a group after the first look', () => {
    const group = new THREE.Group();
    group.updateMatrixWorld(true);
    expect(floorHeightBelow([group], 5, 5, 20, 40)).toBeNull();
    const mesh = new THREE.Mesh(sheets(2, 10), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    group.add(mesh);
    group.updateMatrixWorld(true);
    expect(floorHeightBelow([group], 5, 5, 20, 40)).not.toBeNull();
  });
});

describe('a grid over a floor', () => {
  it('holds one triangle and finds nothing beside it', () => {
    const grid = new FloorGrid(new Float32Array([0, 0, 1, 10, 0, 1, 0, 10, 1]), null);
    expect(grid.highestBelow(2, 2, 5, 10, false)).toBeCloseTo(1);
    expect(grid.highestBelow(9, 9, 5, 10, false)).toBeNull();
    expect(grid.highestBelow(2, 2, 0.5, 10, false)).toBeNull();
  });
});

// @vitest-environment jsdom
import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { WorldControls } from '../../src/renderer/world3d/controls';

const setup = (pick: (x: number, y: number) => THREE.Vector3 | null = () => null) => {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 1000);
  camera.up.set(0, 0, 1);
  const dom = document.createElement('canvas');
  document.body.appendChild(dom);
  const controls = new WorldControls(camera, dom, { pick });
  // Looking at (0, 0, 0) from behind, beside and above, as "Go to" does
  controls.setView(new THREE.Vector3(0, 0, 0), new THREE.Vector3(-30, -30, 30));
  return { camera, dom, controls };
};

const direction = (camera: THREE.Camera) => camera.getWorldDirection(new THREE.Vector3());

describe('the 3D view’s camera', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('starts looking at the point it was sent to', () => {
    const { camera } = setup();
    expect(camera.position.toArray()).toEqual([-30, -30, 30]);
    const toTarget = new THREE.Vector3().sub(camera.position).normalize();
    expect(direction(camera).distanceTo(toTarget)).toBeLessThan(1e-6);
  });

  it('looks around in place on a right-drag: it turns, and does not move', () => {
    const { camera, controls } = setup();
    const before = camera.position.clone();
    const facing = direction(camera);
    controls.look(200, 0);
    expect(camera.position.distanceTo(before)).toBeLessThan(1e-9);
    expect(direction(camera).angleTo(facing)).toBeGreaterThan(0.3);
  });

  it('never tilts past straight up or straight down', () => {
    const { camera, controls } = setup();
    controls.look(0, 100000);
    expect(Math.abs(direction(camera).z)).toBeLessThan(0.9999);
    controls.look(0, -200000);
    expect(Math.abs(direction(camera).z)).toBeLessThan(0.9999);
  });

  it('orbits round the point under the cursor on a left-drag, keeping its distance and looking at it', () => {
    const pivot = new THREE.Vector3(5, 5, 0);
    const { camera, controls } = setup(() => pivot.clone());
    const distance = camera.position.distanceTo(pivot);
    controls.startOrbit(0, 0);
    controls.orbit(300, 40);
    expect(camera.position.distanceTo(pivot)).toBeCloseTo(distance, 6);
    const toPivot = pivot.clone().sub(camera.position).normalize();
    expect(direction(camera).distanceTo(toPivot)).toBeLessThan(1e-6);
  });

  it('orbits round a point a short way ahead when nothing is under the cursor, not one far off', () => {
    const { camera, controls } = setup(() => null);
    const before = camera.position.clone();
    controls.startOrbit(0, 0);
    controls.orbit(400, 0);
    // A wide orbit would fling the camera a long way, which read as a fast pan
    expect(camera.position.distanceTo(before)).toBeLessThan(80);
  });

  it('flies forward on W, the way it is looking, once the view has focus', () => {
    const { camera, controls, dom } = setup();
    dom.focus();
    const facing = direction(camera);
    const before = camera.position.clone();
    controls.keyDown('KeyW');
    controls.update(1);
    controls.keyUp('KeyW');
    const moved = camera.position.clone().sub(before);
    expect(moved.length()).toBeGreaterThan(5);
    expect(moved.normalize().distanceTo(facing)).toBeLessThan(1e-6);
  });

  it('ignores keys while something else has focus, so typing in a field does not move the camera', () => {
    const { camera, controls } = setup();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    const before = camera.position.clone();
    controls.keyDown('KeyW');
    controls.update(1);
    expect(camera.position.distanceTo(before)).toBe(0);
  });

  it('turns on Q and E, rises on Space and sinks on X', () => {
    const { camera, controls, dom } = setup();
    dom.focus();
    const facing = direction(camera);
    controls.keyDown('KeyQ');
    controls.update(0.5);
    controls.keyUp('KeyQ');
    expect(direction(camera).angleTo(facing)).toBeGreaterThan(0.2);
    const z = camera.position.z;
    controls.keyDown('Space');
    controls.update(1);
    controls.keyUp('Space');
    expect(camera.position.z).toBeGreaterThan(z + 5);
    controls.keyDown('KeyX');
    controls.update(2);
    controls.keyUp('KeyX');
    expect(camera.position.z).toBeLessThan(z);
  });

  it('streams the map round where the camera is', () => {
    const { camera, controls } = setup();
    expect([controls.target.x, controls.target.y]).toEqual([camera.position.x, camera.position.y]);
  });
});

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

const fire = (target: EventTarget, type: string, x: number, y: number, init: MouseEventInit = {}) => {
  const event = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, ...init });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  target.dispatchEvent(event);
  return event;
};

const selectSetup = (extra: { onWheel?(deltaY: number): boolean } = {}) => {
  const camera = new THREE.PerspectiveCamera(60, 2, 0.5, 1000);
  camera.up.set(0, 0, 1);
  const host = document.createElement('div');
  const dom = document.createElement('canvas');
  host.appendChild(dom);
  document.body.appendChild(host);
  dom.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON() {} }) as DOMRect;
  const boxes: unknown[] = [];
  const clicks: unknown[] = [];
  const modes: string[] = [];
  const controls = new WorldControls(camera, dom, {
    onBox: (rect, keys) => boxes.push({ rect, keys }),
    onClick: (x, y, keys) => clicks.push({ x, y, keys }),
    onModeChange: (mode) => modes.push(mode),
    ...extra,
  });
  controls.setView(new THREE.Vector3(0, 0, 0), new THREE.Vector3(-30, -30, 30));
  return { camera, host, dom, controls, boxes, clicks, modes };
};

describe('Select mode', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('starts in Camera mode', () => {
    expect(selectSetup().controls.mode).toBe('camera');
  });

  it('draws a box on a left-drag instead of orbiting, and hands over its corners and keys on release', () => {
    const { camera, host, dom, controls, boxes } = selectSetup();
    controls.setMode('select');
    const before = camera.position.clone();
    fire(dom, 'pointerdown', 50, 25, { button: 0 });
    fire(dom, 'pointermove', 150, 75, { button: 0 });
    expect(host.querySelector('.world3d__marquee')).not.toBeNull();
    fire(dom, 'pointerup', 150, 75, { button: 0, shiftKey: true });
    expect(camera.position.distanceTo(before)).toBe(0);
    expect(host.querySelector('.world3d__marquee')).toBeNull();
    expect(boxes).toEqual([{ rect: { x0: -0.5, y0: 0.5, x1: 0.5, y1: -0.5 }, keys: { shift: true, ctrl: false, alt: false } }]);
  });

  it('orbits on Alt+left-drag in Select mode, and draws no box', () => {
    const { camera, host, dom, controls, boxes } = selectSetup();
    controls.setMode('select');
    const before = camera.position.clone();
    fire(dom, 'pointerdown', 50, 25, { button: 0, altKey: true });
    fire(dom, 'pointermove', 150, 25, { button: 0, altKey: true });
    fire(dom, 'pointerup', 150, 25, { button: 0, altKey: true });
    expect(camera.position.distanceTo(before)).toBeGreaterThan(1);
    expect(host.querySelector('.world3d__marquee')).toBeNull();
    expect(boxes).toEqual([]);
  });

  it('a press that does not move is a click with its keys, not a box', () => {
    const { dom, controls, boxes, clicks } = selectSetup();
    controls.setMode('select');
    fire(dom, 'pointerdown', 100, 50, { button: 0 });
    fire(dom, 'pointerup', 100, 50, { button: 0, ctrlKey: true });
    expect(boxes).toEqual([]);
    expect(clicks).toEqual([{ x: 0, y: 0, keys: { shift: false, ctrl: true, alt: false } }]);
  });

  it('in Camera mode a left-drag still orbits and draws no box', () => {
    const { camera, dom, boxes } = selectSetup();
    const before = camera.position.clone();
    fire(dom, 'pointerdown', 50, 25, { button: 0 });
    fire(dom, 'pointermove', 150, 25, { button: 0 });
    fire(dom, 'pointerup', 150, 25, { button: 0 });
    expect(camera.position.distanceTo(before)).toBeGreaterThan(1);
    expect(boxes).toEqual([]);
  });

  it('Tab flips the mode while the view has focus, and only then', () => {
    const { dom, controls, modes } = selectSetup();
    dom.focus();
    const tab = new KeyboardEvent('keydown', { code: 'Tab', key: 'Tab', cancelable: true });
    window.dispatchEvent(tab);
    expect(controls.mode).toBe('select');
    expect(modes).toEqual(['select']);
    expect(tab.defaultPrevented).toBe(true);
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Tab', key: 'Tab', cancelable: true }));
    expect(controls.mode).toBe('select');
  });

  it('gives the wheel to whoever claims it, and then does not move', () => {
    const { camera, dom } = selectSetup({ onWheel: () => true });
    const before = camera.position.clone();
    dom.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: 100, clientY: 50, cancelable: true }));
    expect(camera.position.distanceTo(before)).toBe(0);
  });
});

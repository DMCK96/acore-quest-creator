// @vitest-environment jsdom
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Editor, type EditingWorld } from '../../src/renderer/world3d/editing';
import type { SpawnEdit } from '../../src/renderer/world3d/edits';
import { EMPTY_SELECTION } from '../../src/renderer/world3d/scene/edit/selection';

// The real Gizmo (and Three's TransformControls under it), driven the way a pointer would: the stand-in is turned, then the controls' own events fire
function setup(things: { kind: 'creature' | 'object'; guid: number; x: number; y: number; q?: THREE.Quaternion }[]) {
  const spawns = new Map<string, THREE.Object3D>();
  for (const t of things) {
    const o = new THREE.Object3D();
    o.position.set(t.x, t.y, 0);
    if (t.q) o.quaternion.copy(t.q);
    o.userData.spawn = { kind: t.kind, guid: t.guid, entry: 100 + t.guid, own: false };
    spawns.set(`${t.kind}:${t.guid}`, o);
  }
  const scene = new THREE.Scene();
  const world: EditingWorld = {
    camera: new THREE.PerspectiveCamera(),
    dom: document.createElement('canvas'),
    scene,
    ground: () => [],
    pickGround: () => null,
    rayAt: () => new THREE.Ray(),
    findSpawn: (kind, guid) => spawns.get(`${kind}:${guid}`) ?? null,
    aboard: () => false,
    spawnRoute: () => null,
    pickRoutePoint: () => null,
    setPendingRoute: () => {},
    previewRoute: () => {},
    previewHome: () => {},
    setPendingMovement: () => {},
    spawnMovement: () => null,
  };
  const gestures: SpawnEdit[][] = [];
  const editor = new Editor(world, { onGesture: (g) => gestures.push(g) });
  const controls = scene.children.find((c) => 'dragging' in c && 'axis' in c) as THREE.Object3D & { axis: string | null };
  const turn = async (angle: number) => {
    editor.update();
    const proxy = scene.children.find((c) => c !== controls)!.quaternion;
    controls.axis = 'Z';
    controls.dispatchEvent({ type: 'mouseDown' } as never);
    proxy.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle));
    controls.dispatchEvent({ type: 'objectChange' } as never);
    controls.dispatchEvent({ type: 'mouseUp' } as never);
    await new Promise((r) => setTimeout(r, 0));
  };
  const at = (kind: string, guid: number) => spawns.get(`${kind}:${guid}`)!;
  return { editor, turn, at, gestures };
}

const yaw = (o: THREE.Object3D) => {
  const v = new THREE.Vector3(1, 0, 0).applyQuaternion(o.quaternion);
  return Math.atan2(v.y, v.x);
};

describe('turning several things with the real gizmo', () => {
  it('two NPCs swing round their middle through two drags in a row', async () => {
    const t = setup([{ kind: 'creature', guid: 1, x: 0, y: 0 }, { kind: 'creature', guid: 2, x: 10, y: 0 }]);
    t.editor.setSelection({ ...EMPTY_SELECTION, spawns: [{ kind: 'creature', guid: 1 }, { kind: 'creature', guid: 2 }] });
    t.editor.setMode('rotate');
    await t.turn(Math.PI / 2);
    expect(t.at('creature', 1).position.x).toBeCloseTo(5, 5);
    expect(t.at('creature', 1).position.y).toBeCloseTo(-5, 5);
    await t.turn(Math.PI / 2);
    expect(t.at('creature', 1).position.x).toBeCloseTo(10, 5);
    expect(t.at('creature', 1).position.y).toBeCloseTo(0, 5);
    expect(yaw(t.at('creature', 2))).toBeCloseTo(Math.PI, 5);
  });

  const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 0.3, 0.2));
  const expected = (q: THREE.Quaternion, angle: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle).multiply(q);

  it('tilted objects keep their tilt and gain the turn about Z', async () => {
    const t = setup([{ kind: 'object', guid: 1, x: 0, y: 0, q: tilt }, { kind: 'object', guid: 2, x: 10, y: 0, q: tilt }]);
    t.editor.setSelection({ ...EMPTY_SELECTION, spawns: [{ kind: 'object', guid: 1 }, { kind: 'object', guid: 2 }] });
    t.editor.setMode('rotate');
    await t.turn(Math.PI / 3);
    expect(t.at('object', 1).quaternion.angleTo(expected(tilt, Math.PI / 3))).toBeLessThan(1e-6);
    await t.turn(Math.PI / 3);
    expect(t.at('object', 2).quaternion.angleTo(expected(tilt, (2 * Math.PI) / 3))).toBeLessThan(1e-6);
    expect(t.at('object', 1).position.x).toBeCloseTo(5 - 5 * Math.cos((2 * Math.PI) / 3), 5);
  });

  it('an NPC and an object turn together', async () => {
    const t = setup([{ kind: 'creature', guid: 1, x: 0, y: 0 }, { kind: 'object', guid: 2, x: 10, y: 0, q: tilt }]);
    t.editor.setSelection({ ...EMPTY_SELECTION, spawns: [{ kind: 'creature', guid: 1 }, { kind: 'object', guid: 2 }] });
    t.editor.setMode('rotate');
    await t.turn(1);
    expect(yaw(t.at('creature', 1))).toBeCloseTo(1, 5);
    expect(t.at('object', 2).quaternion.angleTo(expected(tilt, 1))).toBeLessThan(1e-6);
  });

  it('a drag past a half turn ends where it was dragged to', async () => {
    const t = setup([{ kind: 'creature', guid: 1, x: 0, y: 0 }, { kind: 'creature', guid: 2, x: 10, y: 0 }]);
    t.editor.setSelection({ ...EMPTY_SELECTION, spawns: [{ kind: 'creature', guid: 1 }, { kind: 'creature', guid: 2 }] });
    t.editor.setMode('rotate');
    await t.turn(Math.PI * 1.5);
    expect(t.at('creature', 1).position.x).toBeCloseTo(5, 5);
    expect(t.at('creature', 1).position.y).toBeCloseTo(5, 5);
  });
});

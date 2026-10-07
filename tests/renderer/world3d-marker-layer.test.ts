// @vitest-environment jsdom
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

const gizmos = vi.hoisted(() => [] as any[]);
vi.mock('../../src/renderer/world3d/scene/edit/Gizmo', async (importActual) => {
  const actual = await importActual<typeof import('../../src/renderer/world3d/scene/edit/Gizmo')>();
  class FakeGizmo {
    events: any;
    hovered = false;
    dragging = false;
    at: THREE.Vector3 | null = null;
    turns: string | null = null;
    constructor(_camera: unknown, _dom: unknown, _scene: unknown, _ground: unknown, events: any) {
      this.events = events;
      gizmos.push(this);
    }
    get attached() {
      return this.at !== null;
    }
    attach(at: THREE.Vector3, _q: THREE.Quaternion, turns: string) {
      this.at = at.clone();
      this.turns = turns;
    }
    detach() {
      this.at = null;
      this.turns = null;
    }
    setMode() {}
    groundAt() {
      return null;
    }
    dispose() {}
  }
  return { ...actual, Gizmo: FakeGizmo };
});

import { MarkerLayer, type MarkerDrawing } from '../../src/renderer/world3d/scene/marker/MarkerLayer';

const step: MarkerDrawing = { id: 'scene:s1:0:at', kind: 'scenePoint', label: 'Walk · step 1', x: 100, y: 200, z: 10, draggable: true };
const area: MarkerDrawing = { id: 'area:s3', kind: 'area', label: 'Enter · area', x: 300, y: 200, z: 10, draggable: true, radius: 12 };
const poi: MarkerDrawing = { id: 'poi:0', kind: 'poi', label: 'Map marker 0', x: 500, y: 200, z: 0, draggable: false, outline: [{ x: 490, y: 190 }, { x: 510, y: 190 }, { x: 500, y: 210 }] };

function setup(ground: THREE.Object3D[] = []) {
  gizmos.length = 0;
  const scene = new THREE.Scene();
  const moved = vi.fn();
  const layer = new MarkerLayer(new THREE.PerspectiveCamera(), document.createElement('canvas'), scene, () => ground, { moved });
  return { scene, layer, moved, gizmo: gizmos[0] };
}
/** A ray straight down onto a point, from 100 yards above it */
const down = (x: number, y: number, z = 10) => new THREE.Ray(new THREE.Vector3(x, y, z + 100), new THREE.Vector3(0, 0, -1));

describe('the quest markers in the 3D view', () => {
  it('draws each marker, and a ray through one picks it', () => {
    const { scene, layer } = setup();
    layer.set([step, area, poi]);
    expect(scene.getObjectByName('quest-markers')?.children).toHaveLength(3);
    expect(layer.pick(down(100, 200))).toBe('scene:s1:0:at');
    expect(layer.pick(down(300, 200))).toBe('area:s3');
    expect(layer.pick(down(150, 200))).toBeNull();
  });

  it('rings an areatrigger at its radius and outlines a POI', () => {
    const { scene, layer } = setup();
    layer.set([area, poi]);
    const ring = scene.getObjectByName('area:s3')!.getObjectByName('radius')!;
    expect(ring.scale.x).toBe(12);
    const outline = scene.getObjectByName('poi:0')!.getObjectByName('outline') as THREE.LineLoop;
    expect(outline.geometry.getAttribute('position').count).toBe(3);
  });

  it('puts a POI outline on the drawn ground once it is there', () => {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), new THREE.MeshBasicMaterial());
    plane.position.set(500, 200, 42);
    plane.updateMatrixWorld(true);
    const { scene, layer } = setup([plane]);
    layer.set([poi]);
    layer.update();
    const outline = scene.getObjectByName('poi:0')!.getObjectByName('outline') as THREE.LineLoop;
    scene.updateMatrixWorld(true);
    const corner = outline.localToWorld(new THREE.Vector3().fromBufferAttribute(outline.geometry.getAttribute('position'), 0));
    expect(corner.toArray().map((v) => Math.round(v * 10) / 10)).toEqual([490, 190, 42.2]);
    // Its pin stands on the ground at its middle
    expect(layer.pick(down(500, 200, 42))).toBe('poi:0');
  });

  it('selects a draggable marker with the move handles on it, and a POI without them', () => {
    const { layer, gizmo } = setup();
    layer.set([step, poi]);
    expect(layer.select('scene:s1:0:at')).toBe(true);
    expect(layer.selected).toBe('scene:s1:0:at');
    expect(gizmo.at.toArray()).toEqual([100, 200, 10]);
    expect(gizmo.turns).toBe('none');
    layer.select('poi:0');
    expect(layer.selected).toBe('poi:0');
    expect(gizmo.attached).toBe(false);
    expect(layer.select('scene:gone')).toBe(false);
    expect(layer.selected).toBeNull();
  });

  it('a drag of the handles moves the marker and reports where it was let go', async () => {
    const { scene, layer, gizmo, moved } = setup();
    layer.set([step]);
    layer.select('scene:s1:0:at');
    gizmo.events.started();
    gizmo.events.moved({ delta: new THREE.Vector3(5, -2, 0), angle: 0, quaternion: new THREE.Quaternion(), axis: 'XY' });
    expect(scene.getObjectByName('scene:s1:0:at')!.position.toArray()).toEqual([105, 198, 10]);
    await gizmo.events.ended(false);
    expect(moved).toHaveBeenCalledWith('scene:s1:0:at', { x: 105, y: 198, z: 10 }, false);
  });

  it('a press that moves nothing reports nothing', async () => {
    const { layer, gizmo, moved } = setup();
    layer.set([step]);
    layer.select('scene:s1:0:at');
    gizmo.events.started();
    await gizmo.events.ended(false);
    expect(moved).not.toHaveBeenCalled();
  });

  it('keeps the selected marker through a redraw, where its new place is, and lets it go once it is gone', () => {
    const { layer, gizmo } = setup();
    layer.set([step]);
    layer.select('scene:s1:0:at');
    layer.set([{ ...step, x: 120 }]);
    expect(layer.selected).toBe('scene:s1:0:at');
    expect(gizmo.at.x).toBe(120);
    layer.set([]);
    expect(layer.selected).toBeNull();
    expect(gizmo.attached).toBe(false);
  });

  it('a redraw during a drag keeps the marker where it is being dragged, and the drag goes on', async () => {
    const { scene, layer, gizmo, moved } = setup();
    layer.set([step]);
    layer.select('scene:s1:0:at');
    gizmo.events.started();
    gizmo.events.moved({ delta: new THREE.Vector3(5, 0, 0), angle: 0, quaternion: new THREE.Quaternion(), axis: 'XY' });
    layer.set([step, area]);
    expect(scene.getObjectByName('scene:s1:0:at')!.position.x).toBe(105);
    await gizmo.events.ended(false);
    expect(moved).toHaveBeenCalledWith('scene:s1:0:at', { x: 105, y: 200, z: 10 }, false);
  });

  it('takes everything it drew away when disposed', () => {
    const { scene, layer } = setup();
    layer.set([step, area]);
    layer.dispose();
    expect(scene.getObjectByName('quest-markers')).toBeUndefined();
  });
});

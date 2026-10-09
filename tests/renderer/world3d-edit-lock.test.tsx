// @vitest-environment jsdom
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

const gizmos = vi.hoisted(() => [] as any[]);
vi.mock('../../src/renderer/world3d/scene/edit/Gizmo', async (importActual) => {
  const actual = await importActual<typeof import('../../src/renderer/world3d/scene/edit/Gizmo')>();
  class FakeGizmo {
    events: any;
    hovered = false;
    dragging = false;
    at: THREE.Vector3 | null = null;
    constructor(_camera: unknown, _dom: unknown, _scene: unknown, _ground: unknown, events: any) {
      this.events = events;
      gizmos.push(this);
    }
    get attached() {
      return this.at !== null;
    }
    attach(at: THREE.Vector3) {
      this.at = at.clone();
    }
    detach() {
      this.at = null;
    }
    setMode() {}
    groundAt() {
      return 0;
    }
    dispose() {}
  }
  return { ...actual, Gizmo: FakeGizmo };
});

import { Editor, type EditingWorld } from '../../src/renderer/world3d/editing';
import type { EditPoint } from '../../src/renderer/world3d/edits';
import { EMPTY_SELECTION } from '../../src/renderer/world3d/scene/edit/selection';
import { MarkerLayer } from '../../src/renderer/world3d/scene/marker/MarkerLayer';
import { AI_WRITING, editsProject, lockEdits, type MenuGroup } from '../../src/renderer/world3d/menu/model';
import { AiLock, AiWritingNotice } from '../../src/renderer/components/AiLock';
import { HistoryContext } from '../../src/renderer/state/history-context';

function editorSetup() {
  gizmos.length = 0;
  const npc = new THREE.Object3D();
  npc.position.set(5, 5, 0);
  npc.userData.spawn = { kind: 'creature', guid: 1, entry: 101, own: false };
  const route = { pathId: 9, own: false, entry: 101, points: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }] as EditPoint[] };
  const world: EditingWorld = {
    camera: new THREE.PerspectiveCamera(), dom: document.createElement('canvas'), scene: new THREE.Scene(), ground: () => [],
    pickGround: () => new THREE.Vector3(2, 0, 0), rayAt: () => new THREE.Ray(),
    findSpawn: () => npc, spawnRoute: () => route, pickRoutePoint: () => null,
    setPendingRoute: () => {}, previewRoute: () => {}, previewHome: () => {}, setPendingMovement: () => {}, spawnMovement: () => null,
  };
  const gestures: unknown[] = [];
  const editor = new Editor(world, { onGesture: (g) => gestures.push(g), floorZ: async () => 1 });
  editor.setSelection({ ...EMPTY_SELECTION, spawns: [{ kind: 'creature', guid: 1 }], routes: [1], points: [{ guid: 1, index: 0 }] });
  return { editor, gestures, gizmo: gizmos.at(-1), npc };
}

describe('the 3D editor while an AI client is writing', () => {
  it('takes its gizmo away and drops a drag under way, putting the spawn back', () => {
    const { editor, gizmo, npc, gestures } = editorSetup();
    editor.update();
    expect(gizmo.attached).toBe(true);
    gizmo.events.started();
    gizmo.events.moved({ delta: new THREE.Vector3(3, 0, 0), angle: 0, quaternion: new THREE.Quaternion(), axis: null });
    editor.setLocked(true);
    expect(gizmo.attached).toBe(false);
    expect(npc.position.toArray()).toEqual([5, 5, 0]);
    editor.update();
    expect(gizmo.attached).toBe(false);
    expect(gestures).toEqual([]);
  });

  it('gives the gizmo back when it is over', () => {
    const { editor, gizmo } = editorSetup();
    editor.setLocked(true);
    editor.update();
    editor.setLocked(false);
    editor.update();
    expect(gizmo.attached).toBe(true);
  });

  it('inserts and deletes no route points, and starts no path', () => {
    const { editor, gestures } = editorSetup();
    editor.setLocked(true);
    expect(editor.insertPoint(0, 0)).toBe(true);
    expect(editor.keyDown(new KeyboardEvent('keydown', { code: 'Delete' }))).toBe(true);
    editor.startPath(1, 77, { x: 0, y: 0, z: 0 });
    expect(editor.drawing).toBeNull();
    expect(gestures).toEqual([]);
  });

  it('does not finish a path being drawn until it is over', () => {
    const { editor, gestures } = editorSetup();
    editor.startPath(1, 77, { x: 0, y: 0, z: 0 });
    editor.appendPoint(0, 0);
    editor.setLocked(true);
    expect(editor.appendPoint(0, 0)).toBe(true);
    editor.finishPath();
    expect(editor.drawing).not.toBeNull();
    expect(gestures).toEqual([]);
    editor.setLocked(false);
    editor.finishPath();
    expect(gestures).toHaveLength(1);
  });
});

describe('the quest markers while an AI client is writing', () => {
  it('lose their handles, and get them back afterwards', () => {
    gizmos.length = 0;
    const layer = new MarkerLayer(new THREE.PerspectiveCamera(), document.createElement('canvas'), new THREE.Scene(), () => [], { moved: vi.fn() });
    const gizmo = gizmos[0];
    layer.set([{ id: 'scene:s1:0:at', kind: 'scenePoint', label: 'x', x: 100, y: 200, z: 10, draggable: true }]);
    layer.select('scene:s1:0:at');
    expect(gizmo.attached).toBe(true);
    layer.setLocked(true);
    expect(gizmo.attached).toBe(false);
    layer.select('scene:s1:0:at');
    expect(gizmo.attached).toBe(false);
    layer.setLocked(false);
    expect(gizmo.attached).toBe(true);
  });

  it('send nothing for a drag that was under way, and the marker goes back', () => {
    gizmos.length = 0;
    const moved = vi.fn();
    const scene = new THREE.Scene();
    const layer = new MarkerLayer(new THREE.PerspectiveCamera(), document.createElement('canvas'), scene, () => [], { moved });
    const gizmo = gizmos[0];
    layer.set([{ id: 'scene:s1:0:at', kind: 'scenePoint', label: 'x', x: 100, y: 200, z: 10, draggable: true }]);
    layer.select('scene:s1:0:at');
    gizmo.events.started();
    gizmo.events.moved({ delta: new THREE.Vector3(5, 0, 0), angle: 0, quaternion: new THREE.Quaternion(), axis: null });
    layer.setLocked(true);
    gizmo.events.ended(false);
    expect(moved).not.toHaveBeenCalled();
    expect(scene.getObjectByName('scene:s1:0:at')!.position.toArray()).toEqual([100, 200, 10]);
  });
});

describe('the right-click menu while an AI client is writing', () => {
  const at = { x: 0, y: 0, z: 0 };
  const groups: MenuGroup[] = [
    {
      id: 'world',
      items: [
        { id: 'copy', label: 'Copy', action: { kind: 'copy' } },
        { id: 'paste', label: 'Paste', action: { kind: 'paste', at } },
        {
          id: 'more',
          label: 'More',
          children: [
            { id: 'respawn', label: 'Respawn', action: { kind: 'respawn', spawns: [] } },
            { id: 'coords', label: 'Coords', action: { kind: 'copyCoordinates', at } },
          ],
        },
      ],
    },
  ];

  it('disables every item that edits and leaves looking and copying alone', () => {
    const [group] = lockEdits(groups);
    const [copy, paste, more] = group!.items;
    expect(copy!.disabledReason).toBeUndefined();
    expect(paste!.disabledReason).toBe(AI_WRITING);
    expect(more!.children!.map((c) => c.disabledReason)).toEqual([AI_WRITING, undefined]);
  });

  it('counts only reads as safe', () => {
    expect(editsProject({ kind: 'copy' })).toBe(false);
    expect(editsProject({ kind: 'copyCoordinates', at })).toBe(false);
    expect(editsProject({ kind: 'remove', spawn: {} as never })).toBe(true);
    expect(editsProject({ kind: 'startPath', spawn: {} as never, at })).toBe(true);
  });
});

describe('AiLock', () => {
  const steps = (editLocked: boolean) => ({ runStep: async () => {}, hold: () => () => {}, worldLayer: null, editLocked });

  it('greys out and disables what it holds only while a write is on its way', () => {
    const view = (locked: boolean) => (
      <HistoryContext.Provider value={steps(locked)}>
        <AiLock>
          <button>Edit</button>
        </AiLock>
        <AiWritingNotice />
      </HistoryContext.Provider>
    );
    const { rerender, container } = render(view(false));
    expect(container.querySelector('.ai-lock')!.hasAttribute('inert')).toBe(false);
    expect(screen.queryByRole('status')).toBeNull();
    act(() => rerender(view(true)));
    expect(container.querySelector('.ai-lock')!.hasAttribute('inert')).toBe(true);
    expect(screen.getByRole('status').textContent).toMatch(/assistant is changing the project/i);
  });
});

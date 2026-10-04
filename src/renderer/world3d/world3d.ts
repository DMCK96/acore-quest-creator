import * as THREE from 'three';
import { DbManager, MapManager, TextureManager, type SoundManager } from './scene';
import { WorldControls, type ClickKeys, type Tool } from './controls';
import { CharacterTexture } from './scene/character/CharacterTexture';
import { getAssetUrl } from './scene/asset';
import { spawnBounds, type PickedSpawn, type SpawnSource, type SpawnStatus, type SpawnVisibility } from './scene/spawn/SpawnManager';
import type { ViewSpawns } from '@core/db/view-spawns';
import { clearProblems, onProblems } from './scene/diagnostics';
import { ASSET_BASE_URL } from '@core/client/asset-url';
import type { WorldLayer } from '@core/world/layer';
import { Editor, NOT_SNAPPED } from './editing';
import { combine, EMPTY_SELECTION, isEmpty, type Hit, type Modifier, type Selection } from './scene/edit/selection';
import { boxHits, type Rect } from './scene/edit/box';
import type { Falloff } from './scene/edit/falloff';
import type { SpawnEdit, SpawnRef } from './edits';
import { placementAt, type PlaceRequest, type PlaceTarget } from './placing';

/**
 * The 3D world: the game's own terrain, props and models for one map, read from the client's
 * archives through `acqc-wow://`, drawn with Three.js by Wowser's scene classes. World units are
 * the server's (yards, X north, Y west, Z up), so a spawn's `position_x/y/z` is its place here.
 */

export interface World3DOptions {
  container: HTMLElement;
  /** The client folder of the map's terrain, e.g. `azeroth`. */
  directory: string;
  map: number;
  /** Where the camera starts looking. */
  start: { x: number; y: number; z: number };
  /** Told when the terrain around the camera changes to another area. */
  onArea?(name: string): void;
  /** Told once, when the first piece of the world has loaded and drawn. */
  onReady?(): void;
  /** Told what could not be loaded (a model, a terrain tile) while the rest still draws; the whole list each time. */
  onProblems?(problems: readonly string[]): void;
  onError?(message: string): void;
  /** Where the world's NPCs and objects come from; none draws none. */
  spawns?: SpawnSource;
  /** Told which NPC or object was clicked, or null when a click hit neither (or Esc cleared it). */
  onSelect?(spawn: PickedSpawn | null): void;
  /** Told each edit made in the view: a whole placement or a whole route, to store. */
  onEdit?(edit: SpawnEdit): void;
  /** The server's floor nearest a height at a place, or null when it has none there. */
  floorZ?(x: number, y: number, nearZ: number): Promise<number | null>;
  /** Asked once per route before the first change to a world route that is not the quest's. */
  beforeRouteEdit?(spawn: SpawnRef, pathId: number): Promise<boolean>;
  /** Told something about the last edit worth saying (a height not from the server), or null. */
  onNotice?(message: string | null): void;
  /** Told each click that placed the NPC or object being placed (see `setPlacing`). */
  onPlace?(request: PlaceRequest): void;
  /** Told when Esc ended placing. */
  onPlaceEnd?(): void;
  /** Told how much is selected, after every change of the selection. */
  onSelection?(summary: SelectionSummary): void;
  /** Told when Tab flipped between Camera and Select. */
  onTool?(tool: Tool): void;
  /** Told when falloff was switched or its radius changed by a key or the wheel. */
  onFalloff?(falloff: Falloff): void;
  /** Told when a new path starts or stops being drawn, and how many points it has. */
  onDrawing?(drawing: { guid: number; points: number } | null): void;
}

/** How much is selected: NPCs, objects, and route points with how many routes they are on */
export type SelectionSummary = { creatures: number; objects: number; points: number; routes: number };

/** Which of the world's scenery is drawn */
export type Scenery = { buildings: boolean; doodads: boolean };

export interface World3D {
  /** Moves the camera to look at a world point; `close` stands near it (a few yards, to see one NPC or object) rather than far. */
  lookAt(x: number, y: number, z: number, close?: boolean): void;
  /** Where the camera is and which way it looks (a unit vector). */
  camera(): { position: { x: number; y: number; z: number }; direction: { x: number; y: number; z: number } };
  /** Shows or hides buildings and doodads (trees, fences, carts); hidden ones are not hit by clicks either. */
  setScenery(scenery: Scenery): void;
  /** Shows or hides NPCs, objects and their paths, without unloading them. */
  setSpawnVisibility(visibility: SpawnVisibility): void;
  /** Whether a kind of spawn was capped, or why none could be read. */
  spawnStatus(): SpawnStatus;
  /** The open quest's own NPCs and objects, drawn with the world's in place of their database rows. */
  setOwnSpawns(spawns: ViewSpawns): void;
  /** Selects one spawn (outlined while it is drawn, its route active), or clears the selection. */
  select(spawn: { kind: 'creature' | 'object'; guid: number } | null): void;
  /** What a left-drag does: orbit (Camera) or draw a selection box (Select). */
  setTool(tool: Tool): void;
  /** Whether nearby route points follow a move, and how far. */
  setFalloff(falloff: Falloff): void;
  /** Draws the world layer's edits over the database's spawns and routes. */
  setWorldLayer(layer: WorldLayer): void;
  /** Whether the gizmo moves or rotates. */
  setMode(mode: 'move' | 'rotate'): void;
  /** Starts placing an existing NPC or object (each click on the ground places one), or stops with null. */
  setPlacing(target: PlaceTarget | null): void;
  undo(): void;
  redo(): void;
  /** One undo step for edits the host made itself (a placement, a movement): remembered, not sent again. */
  record(before: SpawnEdit[], after: SpawnEdit[]): void;
  /** Starts drawing a new path for a drawn NPC, its first point at `first`; each click then adds a point. */
  startPath(guid: number, pathId: number, first: { x: number; y: number; z: number }): void;
  /** Ends the path being drawn (one of fewer than two points is cancelled). */
  finishPath(): void;
  /** Puts back everything the path being drawn changed. */
  cancelPath(): void;
  /** Takes back the last point of the path being drawn. */
  undoPoint(): void;
  /** Stops drawing (while the world is hidden) or starts again; a hidden world costs nothing. */
  setActive(active: boolean): void;
  /** The point the camera looks at and turns round. */
  target(): { x: number; y: number; z: number };
  dispose(): void;
}

// The game's colours (light bands, vertex colours) are used as they are, as wowserhq's own viewer
// (spelunker) does. With Three's colour management on, every `new THREE.Color(hex)` was taken as sRGB
// and darkened to linear, and the raw scene shaders never brightened it back: the whole world was
// drawn too dark and too red (a #FF8300 sun lost more than half its green)
THREE.ColorManagement.enabled = false;

/** The camera's first distance from its target, in yards: behind, beside and above. */
const START_OFFSET = new THREE.Vector3(-30, -30, 30);
/** Where the camera stands to look at one NPC or object: a few yards away and a little above */
const CLOSE_OFFSET = new THREE.Vector3(-7, -7, 4);
/** A client's maps run ±17066 yards from the middle. */
const WORLD_EDGE = 17066;
const NEAR = 0.5;
const FOV = 60;
const SELECTED_COLOUR = 0xffd34d;
/** The falloff ring: how round it is drawn, and how far above the ground, so it does not sink into it */
const RING_SEGMENTS = 48;
const RING_LIFT = 0.2;

const HOST = { baseUrl: ASSET_BASE_URL, normalizePath: true };
/** Textures and database tables are the same for every map, so every world shares them (and their workers). */
let shared: { textures: TextureManager; databases: DbManager; characterTexture: CharacterTexture } | null = null;
/**
 * The managers every world shares, made once: textures and tables are the same for every map, and so
 * are dressed NPCs' body textures, which are registered with the shared texture manager (one builder
 * per world would build and register every outfit again each time a world opens, and never free them)
 */
export const sharedManagers = (): NonNullable<typeof shared> => {
  if (!shared) {
    const textures = new TextureManager({ host: HOST });
    const characterTexture = new CharacterTexture({
      read: async (path) => {
        const response = await fetch(getAssetUrl(HOST, path));
        return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
      },
      register: (path, texture) => textures.register(path, texture),
    });
    shared = { textures, databases: new DbManager({ host: HOST }), characterTexture };
  }
  return shared;
};

/**
 * Wowser's sound manager plays each area's zone music, which an editor must not, and it throws when
 * disposed before any music has started. The map only ever asks it to set the zone's music.
 */
const SILENT = { setZoneMusic() {}, dispose() {} } as unknown as SoundManager;

/** Frees what a world drew; each step on its own, so one failing cannot stop the rest. */
function release(root: THREE.Object3D): void {
  root.traverse((object) => {
    const drawn = object as THREE.Mesh;
    try {
      drawn.geometry?.dispose();
      for (const material of Array.isArray(drawn.material) ? drawn.material : drawn.material ? [drawn.material] : []) material.dispose();
    } catch {
      // Already freed.
    }
  });
}

export function createWorld3D(options: World3DOptions): World3D {
  const { container } = options;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.domElement.className = 'world3d__canvas';
  container.appendChild(renderer.domElement);

  // The game's colours are already what it shows; no conversion on the way out
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  // No Three lights: terrain, models, buildings and liquids all light themselves from the map's light
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, NEAR, 1000);
  // Z is up in the game's world, and the orbit controls turn about the camera's up axis.
  camera.up.set(0, 0, 1);

  // What is under a place on screen, for orbiting round it and for how far a wheel notch moves: the
  // terrain and buildings only (models and liquid are thin or see-through)
  const raycaster = new THREE.Raycaster();
  // What a click can land on: the terrain, and the buildings while they are shown
  let scenery: Scenery = { buildings: true, doodads: true };
  const clickable = (group: THREE.Object3D): boolean => group.name === 'terrain' || (group.name === 'buildings' && scenery.buildings);
  const pick = (x: number, y: number): THREE.Vector3 | null => {
    raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
    return raycaster.intersectObjects(manager.root.children.filter(clickable), true)[0]?.point ?? null;
  };
  // What is selected: spawns, points of active routes, and the routes being worked on
  let selection: Selection = EMPTY_SELECTION;
  /**
   * A new selection, drawn and told about. `tell` also tells the host which one spawn is selected
   * (or none); a selection the host made itself (`select`) is not told back.
   */
  const setSelection = (next: Selection, tell = true): void => {
    selection = next;
    editor.setSelection(next);
    manager.setActiveRoutes(next.routes);
    manager.markRoutePoints(next.points);
    refreshEscape();
    options.onSelection?.({
      creatures: next.spawns.filter((s) => s.kind === 'creature').length,
      objects: next.spawns.filter((s) => s.kind === 'object').length,
      points: next.points.length,
      routes: new Set(next.points.map((p) => p.guid)).size,
    });
    if (!tell) return;
    const one = next.spawns.length === 1 && next.points.length === 0 ? next.spawns[0]! : null;
    options.onSelect?.(one ? manager.pickedSpawn(one.kind, one.guid) : null);
  };
  // While placing, a click puts the chosen NPC or object on the ground instead of selecting anything
  let placing: PlaceTarget | null = null;
  let tool: Tool = 'camera';
  const refreshEscape = (): void => {
    renderer.domElement.dataset.selection = !isEmpty(selection) || placing ? 'on' : '';
    renderer.domElement.style.cursor = placing ? 'crosshair' : tool === 'select' ? 'default' : '';
  };
  const applyTool = (next: Tool): void => {
    tool = next;
    controls.setMode(next);
    refreshEscape();
  };
  const place = async (x: number, y: number): Promise<void> => {
    const target = placing;
    const ground = target ? pick(x, y) : null;
    if (!target) return;
    if (!ground) {
      options.onNotice?.('Click the ground or a building to place it.');
      return;
    }
    const at = placementAt(ground, camera.position, target.kind);
    // Onto the server's floor nearest where it was clicked, as a moved spawn is
    const floor = options.floorZ ? await options.floorZ(at.x, at.y, at.z) : at.z;
    options.onNotice?.(floor === null ? NOT_SNAPPED : null);
    if (placing === target) options.onPlace?.({ target, at: { ...at, z: floor ?? at.z } });
  };
  /** What is under a place on screen: a point of an active route first, else the nearest spawn nothing solid stands in front of */
  const hitAt = (x: number, y: number): Hit => {
    raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
    const ray = raycaster.ray.clone();
    let nearest: { guid: number; index: number; distance: number } | null = null;
    for (const guid of selection.routes) {
      const index = manager.pickRoutePoint(ray, guid);
      const at = index === null ? null : manager.spawnRoute(guid)?.points[index];
      if (index === null || !at) continue;
      const distance = ray.origin.distanceTo(new THREE.Vector3(at.x, at.y, at.z));
      if (!nearest || distance < nearest.distance) nearest = { guid, index, distance };
    }
    if (nearest) return { points: [{ guid: nearest.guid, index: nearest.index }] };
    const ground = pick(x, y);
    const spawn = manager.pickSpawn(ray, ground ? ground.distanceTo(camera.position) : Infinity);
    return { spawns: spawn ? [{ kind: spawn.kind, guid: spawn.guid }] : [] };
  };
  const modifierOf = (keys: ClickKeys): Modifier => (keys.ctrl ? 'remove' : keys.shift ? 'add' : 'replace');
  const click = (x: number, y: number, keys: ClickKeys): void => {
    // While a path is drawn, each click on the ground is its next point
    if (editor.appendPoint(x, y)) return;
    if (placing) {
      void place(x, y);
      return;
    }
    // A new route point: Shift-click in Camera mode, Alt-click in Select mode
    if ((tool === 'camera' ? keys.shift : keys.alt) && editor.insertPoint(x, y)) return;
    const hit = hitAt(x, y);
    if ('points' in hit) options.onNotice?.(null);
    setSelection(combine(selection, hit, tool === 'select' ? modifierOf(keys) : 'replace'));
  };
  // A box drawn in Select mode: the route points or spawns inside it, by where they land on screen
  const box = (rect: Rect, keys: ClickKeys): void => {
    if (placing) return;
    const project = (at: { x: number; y: number; z: number }) => new THREE.Vector3(at.x, at.y, at.z).project(camera);
    setSelection(combine(selection, boxHits(manager.selectionCandidates(camera.position), project, rect), modifierOf(keys)));
  };
  const controls = new WorldControls(camera, renderer.domElement, {
    pick,
    onClick: click,
    onBox: box,
    onWheel: (deltaY) => editor.wheel(deltaY),
    onModeChange: (next) => {
      applyTool(next);
      options.onTool?.(next);
    },
    blocked: () => editor.blocked,
  });
  const solid = (): THREE.Object3D[] => manager.root.children.filter(clickable);
  const editor = new Editor(
    {
      camera,
      dom: renderer.domElement,
      scene,
      ground: solid,
      pickGround: pick,
      rayAt: (x, y) => {
        raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
        return raycaster.ray.clone();
      },
      findSpawn: (kind, guid) => manager.findSpawn(kind, guid),
      spawnRoute: (guid) => manager.spawnRoute(guid),
      pickRoutePoint: (ray, guid) => manager.pickRoutePoint(ray, guid),
      setPendingRoute: (guid, points) => manager.setPendingRoute(guid, points),
      previewRoute: (guid, points) => manager.previewRoute(guid, points),
      previewHome: (guid, at) => manager.previewHome(guid, at),
      setPendingMovement: (guid, movement) => manager.setPendingMovement(guid, movement),
      spawnMovement: (guid) => manager.movement(guid),
    },
    {
      onEdit: options.onEdit,
      floorZ: options.floorZ,
      beforeRouteEdit: options.beforeRouteEdit,
      onNotice: options.onNotice,
      // A delete or an insert changed the picked points
      onSelection: (next) => setSelection(next, false),
      onFalloff: (next) => options.onFalloff?.(next),
      onDrawing: (drawing) => options.onDrawing?.(drawing),
    },
  );
  // The editing keys, on the view itself so they only act while it has focus; a key used here goes
  // no further (Esc that clears a selection must not also close the screen or the quest editor)
  const onKeyDown = (event: KeyboardEvent): void => {
    // Esc finishes a path being drawn first
    if (event.code === 'Escape' && editor.drawing) {
      editor.finishPath();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const used = event.code === 'Escape' ? !isEmpty(selection) || placing !== null : editor.keyDown(event);
    if (event.code === 'Escape' && placing) {
      // Esc stops placing first; a second one clears the selection
      placing = null;
      refreshEscape();
      options.onPlaceEnd?.();
    } else if (event.code === 'Escape' && !isEmpty(selection)) {
      setSelection(EMPTY_SELECTION);
    }
    if (used) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  renderer.domElement.addEventListener('keydown', onKeyDown);

  // An outline round each selected spawn (its bounds), and a falloff ring round each picked point,
  // followed every frame: what they are on may be redrawn, move, or leave
  const outlines: THREE.Box3Helper[] = [];
  const rings: THREE.LineLoop[] = [];
  const ringGeometry = new THREE.BufferGeometry().setFromPoints(
    Array.from({ length: RING_SEGMENTS }, (_, i) => new THREE.Vector3(Math.cos((i / RING_SEGMENTS) * Math.PI * 2), Math.sin((i / RING_SEGMENTS) * Math.PI * 2), 0)),
  );
  const ringMaterial = new THREE.LineBasicMaterial({ color: SELECTED_COLOUR, depthTest: false });
  /** The pool's first `count` members, made as needed; the rest hidden */
  const pooled = <T extends THREE.Object3D>(pool: T[], count: number, make: () => T): T[] => {
    while (pool.length < count) {
      const made = make();
      scene.add(made);
      pool.push(made);
    }
    pool.forEach((member, i) => (member.visible = i < count));
    return pool.slice(0, count);
  };
  const followSelected = (): void => {
    const drawn = selection.spawns.flatMap((s) => manager.findSpawn(s.kind, s.guid) ?? []);
    pooled(outlines, drawn.length, () => {
      const outline = new THREE.Box3Helper(new THREE.Box3(), SELECTED_COLOUR);
      (outline.material as THREE.LineBasicMaterial).depthTest = false;
      outline.renderOrder = 1;
      return outline;
    }).forEach((outline, i) => spawnBounds(drawn[i]!, outline.box));
    const falloff = editor.falloff;
    const points = falloff.on ? editor.pointPositions() : [];
    pooled(rings, points.length, () => {
      const ring = new THREE.LineLoop(ringGeometry, ringMaterial);
      ring.renderOrder = 2;
      return ring;
    }).forEach((ring, i) => {
      const at = points[i]!;
      ring.position.set(at.x, at.y, at.z + RING_LIFT);
      ring.scale.set(falloff.radius, falloff.radius, 1);
      ring.updateMatrixWorld(true);
    });
  };
  const { textures, databases, characterTexture } = sharedManagers();
  // The drawn ground a short way below a point, for standing NPCs on it
  const down = new THREE.Raycaster();
  const groundBelow = (x: number, y: number, fromZ: number, distance: number): number | null => {
    down.set(new THREE.Vector3(x, y, fromZ), new THREE.Vector3(0, 0, -1));
    down.far = distance;
    // Every floor, shown or not: where an NPC stands does not change with what is drawn
    const floors = manager.root.children.filter((group) => group.name === 'terrain' || group.name === 'buildings');
    return down.intersectObjects(floors, true)[0]?.point.z ?? null;
  };
  const manager = new MapManager({ host: HOST, textureManager: textures, dbManager: databases, characterTexture, soundManager: SILENT, groundBelow });
  manager.addEventListener('area:change', (event) => {
    const name = (event as CustomEvent<{ areaName?: string }>).detail.areaName;
    if (name) options.onArea?.(name);
  });
  scene.add(manager.root);
  clearProblems();
  const stopProblems = onProblems((all) => options.onProblems?.([...all]));

  let disposed = false;
  const lookAt = (x: number, y: number, z: number, close = false): void => {
    controls.setView(new THREE.Vector3(x, y, z), close ? CLOSE_OFFSET : START_OFFSET);
    manager.setTarget(clamp(x), clamp(y));
  };
  const clamp = (v: number): number => Math.max(-WORLD_EDGE, Math.min(WORLD_EDGE, v));

  try {
    manager.setSpawnSource(options.spawns ?? null);
    manager.load(options.directory, options.map);
    lookAt(options.start.x, options.start.y, options.start.z);
  } catch (error) {
    options.onError?.(error instanceof Error ? error.message : String(error));
  }

  const resize = (): void => {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  const clock = new THREE.Clock();
  let frame = 0;
  let ready = false;
  let running = true;
  const tick = (): void => {
    if (disposed || !running) return;
    frame = requestAnimationFrame(tick);
    const delta = clock.getDelta();
    try {
      controls.update(delta);
      manager.setTarget(clamp(controls.target.x), clamp(controls.target.y));
      camera.far = manager.cameraFar;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      manager.update(delta, camera);
      followSelected();
      editor.update();
      renderer.setClearColor(manager.clearColor);
      renderer.render(scene, camera);
      if (!ready && manager.root.children.length > 0) {
        ready = true;
        options.onReady?.();
      }
    } catch (error) {
      options.onError?.(error instanceof Error ? error.message : String(error));
      disposed = true;
    }
  };
  frame = requestAnimationFrame(tick);

  return {
    lookAt,
    setSpawnVisibility: (visibility) => manager.setSpawnVisibility(visibility),
    setScenery(next) {
      scenery = { ...next };
      manager.setScenery(scenery);
    },
    spawnStatus: () => manager.spawnStatus,
    setOwnSpawns: (spawns) => manager.setOwnSpawns(spawns),
    select: (spawn) => setSelection(spawn ? combine(EMPTY_SELECTION, { spawns: [spawn] }, 'replace') : EMPTY_SELECTION, false),
    setTool: (next) => applyTool(next),
    setFalloff: (falloff) => editor.setFalloff(falloff),
    setWorldLayer: (layer) => manager.setWorldLayer(layer),
    setMode: (mode) => editor.setMode(mode),
    setPlacing: (target) => {
      placing = target;
      // Placing starts from nothing selected, so a click never means anything else
      if (target && !isEmpty(selection)) setSelection(EMPTY_SELECTION);
      refreshEscape();
    },
    undo: () => editor.undo(),
    redo: () => editor.redo(),
    record: (before, after) => editor.record(before, after),
    startPath: (guid, pathId, first) => editor.startPath(guid, pathId, first),
    finishPath: () => editor.finishPath(),
    cancelPath: () => editor.cancelPath(),
    undoPoint: () => editor.undoPoint(),
    setActive(active) {
      if (active === running || disposed) return;
      running = active;
      if (active) {
        // The time spent hidden is not one long frame
        clock.getDelta();
        frame = requestAnimationFrame(tick);
      } else {
        cancelAnimationFrame(frame);
      }
    },
    target: () => ({ x: controls.target.x, y: controls.target.y, z: controls.target.z }),
    camera() {
      const direction = camera.getWorldDirection(new THREE.Vector3());
      return { position: { ...camera.position }, direction: { x: direction.x, y: direction.y, z: direction.z } };
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      // Nothing here may throw: this runs while React unmounts the view, and a throw would take the whole screen with it.
      for (const step of [() => controls.dispose?.(), () => renderer.domElement.removeEventListener('keydown', onKeyDown), () => editor.dispose(), stopProblems, () => manager.dispose(), () => release(manager.root), () => outlines.forEach(release), () => rings.forEach((ring) => ring.removeFromParent()), () => ringGeometry.dispose(), () => ringMaterial.dispose(), () => renderer.dispose()]) {
        try {
          step();
        } catch (error) {
          console.warn(`3D view cleanup: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      renderer.domElement.remove();
    },
  };
}

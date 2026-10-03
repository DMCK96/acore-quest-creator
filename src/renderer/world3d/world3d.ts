import * as THREE from 'three';
import { DbManager, MapManager, TextureManager, type SoundManager } from './scene';
import { WorldControls } from './controls';
import { spawnBounds, type PickedSpawn, type SpawnSource, type SpawnStatus, type SpawnVisibility } from './scene/spawn/SpawnManager';
import type { ViewSpawns } from '@core/db/view-spawns';
import { clearProblems, onProblems } from './scene/diagnostics';
import { ASSET_BASE_URL } from '@core/client/asset-url';
import type { WorldLayer } from '@core/world/layer';
import { Editor } from './editing';
import type { SpawnEdit, SpawnRef } from './edits';

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
}

export interface World3D {
  /** Moves the camera to look at a world point. */
  lookAt(x: number, y: number, z: number): void;
  /** Where the camera is and which way it looks (a unit vector). */
  camera(): { position: { x: number; y: number; z: number }; direction: { x: number; y: number; z: number } };
  /** Shows or hides NPCs, objects and their paths, without unloading them. */
  setSpawnVisibility(visibility: SpawnVisibility): void;
  /** Whether a kind of spawn was capped, or why none could be read. */
  spawnStatus(): SpawnStatus;
  /** The open quest's own NPCs and objects, drawn with the world's in place of their database rows. */
  setOwnSpawns(spawns: ViewSpawns): void;
  /** Marks a spawn as selected (outlined while it is drawn), or clears the selection. */
  select(spawn: { kind: 'creature' | 'object'; guid: number } | null): void;
  /** Draws the world layer's edits over the database's spawns and routes. */
  setWorldLayer(layer: WorldLayer): void;
  /** Whether the gizmo moves or rotates. */
  setMode(mode: 'move' | 'rotate'): void;
  undo(): void;
  redo(): void;
  dispose(): void;
}

// The game's colours (light bands, vertex colours) are used as they are, as wowserhq's own viewer
// (spelunker) does. With Three's colour management on, every `new THREE.Color(hex)` was taken as sRGB
// and darkened to linear, and the raw scene shaders never brightened it back: the whole world was
// drawn too dark and too red (a #FF8300 sun lost more than half its green)
THREE.ColorManagement.enabled = false;

/** The camera's first distance from its target, in yards: behind, beside and above. */
const START_OFFSET = new THREE.Vector3(-30, -30, 30);
/** A client's maps run ±17066 yards from the middle. */
const WORLD_EDGE = 17066;
const NEAR = 0.5;
const FOV = 60;
const SELECTED_COLOUR = 0xffd34d;

const HOST = { baseUrl: ASSET_BASE_URL, normalizePath: true };
/** Textures and database tables are the same for every map, so every world shares them (and their workers). */
let shared: { textures: TextureManager; databases: DbManager } | null = null;
const sharedManagers = (): NonNullable<typeof shared> => (shared ??= { textures: new TextureManager({ host: HOST }), databases: new DbManager({ host: HOST }) });

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
  const pick = (x: number, y: number): THREE.Vector3 | null => {
    raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
    const solid = manager.root.children.filter((group) => group.name === 'terrain' || group.name === 'buildings');
    return raycaster.intersectObjects(solid, true)[0]?.point ?? null;
  };
  // A click selects the nearest NPC or object under it that nothing solid stands in front of, unless
  // it was on the selected NPC's route (a point, or Shift to add one)
  let selected: { kind: 'creature' | 'object'; guid: number } | null = null;
  const choose = (spawn: { kind: 'creature' | 'object'; guid: number } | null): void => {
    selected = spawn ? { kind: spawn.kind, guid: spawn.guid } : null;
    manager.setSelectedSpawn(selected);
    editor.select(selected);
  };
  const click = (x: number, y: number, shift: boolean): void => {
    if (editor.click(x, y, shift)) return;
    raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
    const ground = pick(x, y);
    const spawn = manager.pickSpawn(raycaster.ray, ground ? ground.distanceTo(camera.position) : Infinity);
    choose(spawn);
    options.onSelect?.(spawn);
  };
  const controls = new WorldControls(camera, renderer.domElement, { pick, onClick: click, blocked: () => editor.blocked });
  const solid = (): THREE.Object3D[] => manager.root.children.filter((group) => group.name === 'terrain' || group.name === 'buildings');
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
      routeBall: (guid, point) => manager.routeBall(guid, point),
      setPendingRoute: (guid, points) => manager.setPendingRoute(guid, points),
    },
    options,
  );
  // The editing keys, only while the view has focus (typing in a field edits nothing here)
  const onKeyDown = (event: KeyboardEvent): void => {
    if (document.activeElement !== renderer.domElement) return;
    if (event.code === 'Escape' && selected) {
      choose(null);
      options.onSelect?.(null);
      event.preventDefault();
      return;
    }
    if (editor.keyDown(event)) event.preventDefault();
  };
  window.addEventListener('keydown', onKeyDown);

  // The selected spawn's outline: its bounds, followed every frame (it may be redrawn, or leave)
  const outline = new THREE.Box3Helper(new THREE.Box3(), SELECTED_COLOUR);
  (outline.material as THREE.LineBasicMaterial).depthTest = false;
  outline.renderOrder = 1;
  outline.visible = false;
  scene.add(outline);
  const followSelected = (): void => {
    const drawn = selected ? manager.findSpawn(selected.kind, selected.guid) : null;
    outline.visible = drawn !== null;
    if (drawn) spawnBounds(drawn, outline.box);
  };
  const { textures, databases } = sharedManagers();
  const manager = new MapManager({ host: HOST, textureManager: textures, dbManager: databases, soundManager: SILENT });
  manager.addEventListener('area:change', (event) => {
    const name = (event as CustomEvent<{ areaName?: string }>).detail.areaName;
    if (name) options.onArea?.(name);
  });
  scene.add(manager.root);
  clearProblems();
  const stopProblems = onProblems((all) => options.onProblems?.([...all]));

  let disposed = false;
  const lookAt = (x: number, y: number, z: number): void => {
    controls.setView(new THREE.Vector3(x, y, z), START_OFFSET);
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
  const tick = (): void => {
    if (disposed) return;
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
    spawnStatus: () => manager.spawnStatus,
    setOwnSpawns: (spawns) => manager.setOwnSpawns(spawns),
    select: (spawn) => choose(spawn),
    setWorldLayer: (layer) => manager.setWorldLayer(layer),
    setMode: (mode) => editor.setMode(mode),
    undo: () => editor.undo(),
    redo: () => editor.redo(),
    camera() {
      const direction = camera.getWorldDirection(new THREE.Vector3());
      return { position: { ...camera.position }, direction: { x: direction.x, y: direction.y, z: direction.z } };
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      // Nothing here may throw: this runs while React unmounts the view, and a throw would take the whole screen with it.
      for (const step of [() => controls.dispose?.(), () => window.removeEventListener('keydown', onKeyDown), () => editor.dispose(), stopProblems, () => manager.dispose(), () => release(manager.root), () => release(outline), () => renderer.dispose()]) {
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

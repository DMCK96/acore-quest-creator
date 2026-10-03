import * as THREE from 'three';
import { DbManager, MapControls, MapManager, TextureManager, type SoundManager } from './scene';
import { clearProblems, onProblems } from './scene/diagnostics';
import { ASSET_BASE_URL } from '@core/client/asset-url';

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
}

export interface World3D {
  /** Moves the camera to look at a world point. */
  lookAt(x: number, y: number, z: number): void;
  dispose(): void;
}

/** The camera's first distance from its target, in yards: behind, beside and above. */
const START_OFFSET = new THREE.Vector3(-30, -30, 30);
/** A client's maps run ±17066 yards from the middle. */
const WORLD_EDGE = 17066;
const NEAR = 0.5;
const FOV = 60;

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

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, NEAR, 1000);
  // Z is up in the game's world, and the orbit controls turn about the camera's up axis.
  camera.up.set(0, 0, 1);

  const controls = new MapControls(camera, renderer.domElement);
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
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      // Nothing here may throw: this runs while React unmounts the view, and a throw would take the whole screen with it.
      for (const step of [() => controls.dispose?.(), stopProblems, () => manager.dispose(), () => release(manager.root), () => renderer.dispose()]) {
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

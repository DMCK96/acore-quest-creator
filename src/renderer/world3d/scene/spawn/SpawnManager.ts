// @ts-nocheck
/**
 * The world's NPCs and objects in the 3D view: one group per loaded area (a 533-yard tile), like the
 * terrain, buildings and liquid. Each spawn is drawn with its display's model (or building), placed by
 * its position, facing and scale; one that cannot be drawn is a marker, logged once to the console.
 * Spawns come from a source (the world database through the app); a source that cannot give them
 * leaves the world drawn without them.
 */
import * as THREE from 'three';
import { ViewCreature, ViewObject, ViewPoint, ViewSpawns } from '../../../../core/db/view-spawns.js';
import { WorldLayer } from '../../../../core/world/layer.js';
import { BodyTexture, DisplayResolver, Look, ModelLook } from './DisplayResolver.js';
import { creatureTransform, objectTransform, Transform } from './placement.js';
import { routeObject, wanderObject } from './paths.js';

type Box = { minX: number; maxX: number; minY: number; maxY: number };

type SpawnSource = (map: number, box: Box) => Promise<ViewSpawns | { error: string }>;

/** Which spawns are drawn; `events` takes in those that appear only while a game event runs */
type SpawnVisibility = { creatures: boolean; objects: boolean; paths: boolean; events: boolean };

/** What a spawn is, as picking one says */
type PickedSpawn = {
  kind: 'creature' | 'object';
  guid: number;
  entry: number;
  name: string;
  own: boolean;
  /** One placed in the 3D view and not in the database (yet) */
  added: boolean;
  /** An NPC's route id; 0 for one without a route, and for objects */
  pathId: number;
  event: { id: number; name: string } | null;
  position: { x: number; y: number; z: number };
};

type SpawnManagerOptions = {
  resolver: DisplayResolver;
  createModel(look: ModelLook): Promise<THREE.Object3D>;
  createBuilding(path: string): Promise<THREE.Object3D>;
  source: SpawnSource | null;
  /** Builds a dressed NPC's body texture, giving the path it can be asked for by; null when it cannot */
  bodyTexture?(body: BodyTexture): Promise<string | null>;
  /** The time in milliseconds (for when to ask again after a failure); Date.now by default */
  now?: () => number;
  /**
   * The height of the drawn ground (terrain or a building's floor) nearest below `fromZ`, no further
   * down than `distance`; null when there is none (or the terrain there has not loaded yet)
   */
  groundBelow?(x: number, y: number, fromZ: number, distance: number): number | null;
};

/** Whether a kind was capped, why none could be read, and how many areas are still loading */
type SpawnStatus = { capped: { creatures: boolean; objects: boolean }; error: string | null; loading?: number };

/** A marker: a small upright box standing on the spawn point */
const MARKER_SIZE = { width: 0.6, height: 1.8 };
const CREATURE_MARKER_COLOUR = 0xe0a040;
const OBJECT_MARKER_COLOUR = 0x40a0e0;

const markerGeometry = (() => {
  const geometry = new THREE.BoxGeometry(MARKER_SIZE.width, MARKER_SIZE.width, MARKER_SIZE.height);
  geometry.translate(0, 0, MARKER_SIZE.height / 2);
  return geometry;
})();
const markerMaterials = {
  creature: new THREE.MeshBasicMaterial({ color: CREATURE_MARKER_COLOUR }),
  object: new THREE.MeshBasicMaterial({ color: OBJECT_MARKER_COLOUR }),
};

/** Spawns further than this from the camera are not drawn, as in the game (about 100 yards) */
const SPAWN_DRAW_DISTANCE = 100;

/** M2 attachment points: a shield on the arm, weapons in the right (1) and left (2) hands */
const SHIELD_POINT = 0;

/** How long to wait before asking again for an area whose answer failed */
const RETRY_MS = 30000;

/**
 * A database Z is where the server put an NPC, and the server snaps NPCs to the real floor as they
 * spawn, so a stored Z is often a little below the drawn ground. An NPC is drawn lifted onto the
 * ground when that is within this many yards above its Z; further than that is taken as meant.
 */
const GROUND_REACH = 1.5;
/** Where the ground is not there yet (its terrain still loading), asked again this often, this many times */
const GROUND_RETRY_MS = 2000;
const GROUND_TRIES = 4;
/** NPCs grounded in one frame at most, so a crowd coming into range does not stall it */
const GROUNDS_PER_FRAME = 16;

/**
 * Each geometry's bounds from its own vertices, kept once worked out. A model's stored bounds take in
 * the reach of every animation it has, which for a guard is a box thirty yards wide.
 */
const vertexBounds = new WeakMap<THREE.BufferGeometry, THREE.Box3>();
const boundsOf = (geometry: THREE.BufferGeometry): THREE.Box3 => {
  let bounds = vertexBounds.get(geometry);
  if (!bounds) {
    const position = geometry.getAttribute('position');
    bounds = position ? new THREE.Box3().setFromBufferAttribute(position) : new THREE.Box3();
    vertexBounds.set(geometry, bounds);
  }
  return bounds;
};

/** A drawn spawn's bounds in the world, as it stands (with what it holds), into `target` */
function spawnBounds(spawn: THREE.Object3D, target: THREE.Box3): THREE.Box3 {
  const part = new THREE.Box3();
  target.makeEmpty();
  spawn.traverseVisible((object) => {
    const geometry = (object as THREE.Mesh).geometry;
    if (geometry) target.union(part.copy(boundsOf(geometry)).applyMatrix4(object.matrixWorld));
  });
  return target;
}

/** Event spawns are left out until asked for: a town would otherwise show every holiday at once */
const DEFAULT_VISIBILITY: SpawnVisibility = { creatures: true, objects: true, paths: true, events: false };

class SpawnManager {
  #resolver: DisplayResolver;
  #createModel: SpawnManagerOptions['createModel'];
  #createBuilding: SpawnManagerOptions['createBuilding'];
  #bodyTexture: SpawnManagerOptions['bodyTexture'];
  #source: SpawnSource | null;

  #areas = new globalThis.Map<number, THREE.Group>();
  /** Each area's last answer from the source, so the area can be redrawn without asking again */
  #responses = new globalThis.Map<number, { map: number; box: Box; spawns: ViewSpawns }>();
  /** Areas asked for and not removed since; a removal while asking drops the answer */
  #wanted = new globalThis.Map<number, number>();
  #requests = 0;
  #visibility: SpawnVisibility = { ...DEFAULT_VISIBILITY };
  #own: ViewSpawns = { creatures: [], objects: [], capped: { creatures: false, objects: false } };
  #warned = new Set<string>();
  #now: () => number;
  #groundBelow: SpawnManagerOptions['groundBelow'];
  /** Areas whose answer failed, and when they may be asked for again */
  #failed = new globalThis.Map<number, number>();

  /** Edits to database spawns and routes, drawn over what the database has */
  #layer: WorldLayer = { spawns: [], routes: [], added: [] };

  /** Routes edited in the view and not yet stored by its host, drawn in place of what it has */
  #pendingRoutes = new globalThis.Map<number, ViewPoint[]>();

  /** The selected spawn, whose paths are the ones drawn */
  #selected: { kind: 'creature' | 'object'; guid: number } | null = null;

  status: SpawnStatus = { capped: { creatures: false, objects: false }, error: null };

  constructor(options: SpawnManagerOptions) {
    this.#resolver = options.resolver;
    this.#createModel = options.createModel;
    this.#createBuilding = options.createBuilding;
    this.#bodyTexture = options.bodyTexture;
    this.#source = options.source;
    this.#now = options.now ?? Date.now;
    this.#groundBelow = options.groundBelow;
  }

  /** Areas asked for and not yet drawn (their spawns on their way, or their models loading) */
  get loading(): number {
    let count = 0;
    for (const areaId of this.#wanted.keys()) if (!this.#areas.has(areaId)) count += 1;
    return count;
  }

  /** A new source: areas that failed may be asked for again at once */
  setSource(source: SpawnSource | null) {
    this.#source = source;
    this.#failed.clear();
  }

  /**
   * Whether an area may be asked for now: not drawn, not on its way (whatever an older, stale request
   * for it does), and not failed within the last RETRY_MS
   */
  canLoad(areaId: number): boolean {
    if (this.#areas.has(areaId) || this.#wanted.has(areaId)) {
      return false;
    }
    const retryAt = this.#failed.get(areaId);
    return retryAt === undefined || this.#now() >= retryAt;
  }

  /** The area's spawns as a group, or null when there are none to draw or it was removed meanwhile */
  async loadArea(areaId: number, map: number, box: Box): Promise<THREE.Group | null> {
    if (!this.#source) {
      return null;
    }

    const request = ++this.#requests;
    this.#wanted.set(areaId, request);

    let answer: ViewSpawns | { error: string };
    try {
      answer = await this.#source(map, box);
    } catch (error) {
      answer = { error: error instanceof Error ? error.message : String(error) };
    }

    if (this.#wanted.get(areaId) !== request) {
      return null;
    }
    if ('error' in answer) {
      this.status = { ...this.status, error: answer.error };
      this.#wanted.delete(areaId);
      this.#failed.set(areaId, this.#now() + RETRY_MS);
      return null;
    }
    this.#failed.delete(areaId);

    this.status = { capped: { ...answer.capped }, error: null };
    this.#responses.set(areaId, { map, box, spawns: answer });

    const group = await this.#draw(this.#overlay(answer, box, map));
    if (this.#wanted.get(areaId) !== request) {
      return null;
    }

    this.#areas.set(areaId, group);
    return group;
  }

  /** Drops an area's spawns and frees them; an answer still on its way for it is dropped too */
  removeArea(areaId: number) {
    const group = this.#areas.get(areaId);
    if (group) {
      group.userData.fill = (group.userData.fill ?? 0) + 1;
      this.#release(group);
      group.clear();
    }
    this.#wanted.delete(areaId);
    this.#responses.delete(areaId);
    this.#areas.delete(areaId);
  }

  /**
   * The open quest's own spawns, drawn in whichever loaded area holds them, in place of a database
   * spawn with the same guid. Loaded areas are redrawn from their last answer, without asking again.
   */
  async setOwnSpawns(spawns: ViewSpawns) {
    this.#own = spawns;
    this.#pendingRoutes.clear();
    await this.#redraw();
  }

  /**
   * An area's database spawns as edited in the world layer (moved, turned, rerouted), less any the
   * open quest has its own of, plus its own in the box on its map; without event spawns unless they
   * are asked for
   */
  #overlay(spawns: ViewSpawns, box: Box, map: number): ViewSpawns {
    const inBox = (s: { map: number; x: number; y: number }) => s.map === map && s.x >= box.minX && s.x <= box.maxX && s.y >= box.minY && s.y <= box.maxY;
    const shown = (s: { event?: unknown }) => this.#visibility.events || !s.event;
    const ownCreatures = new Set(this.#own.creatures.map((c) => c.guid));
    const ownObjects = new Set(this.#own.objects.map((o) => o.guid));
    const placed = (kind: 'creature' | 'gameobject', guid: number) => this.#layer.spawns.find((s) => s.kind === kind && s.guid === guid)?.current;
    const routes = new globalThis.Map(this.#layer.routes.map((r) => [r.pathId, r.current]));
    const creature = (c: ViewCreature): ViewCreature => {
      const at = placed('creature', c.guid);
      const route = c.pathId > 0 ? routes.get(c.pathId) : undefined;
      return {
        ...c,
        ...(at ? { x: at.x, y: at.y, z: at.z, orientation: at.orientation } : {}),
        ...(route ? { path: route.map((p): ViewPoint => ({ x: p.x, y: p.y, z: p.z, carry: p.rest })) } : {}),
      };
    };
    const pending = (c: ViewCreature): ViewCreature => {
      const route = this.#pendingRoutes.get(c.guid);
      return route ? { ...c, path: route } : c;
    };
    const object = (o: ViewObject): ViewObject => {
      const at = placed('gameobject', o.guid);
      return at ? { ...o, x: at.x, y: at.y, z: at.z, ...(at.rotation ? { rotation: at.rotation } : {}) } : o;
    };
    // Spawns placed in the view, drawn as their template looked when they were placed
    const placedCreatures = this.#layer.added.filter((a) => a.kind === 'creature').map(
      (a): ViewCreature => ({
        guid: a.guid, entry: a.entry, name: a.name, map: a.map, x: a.placement.x, y: a.placement.y, z: a.placement.z, orientation: a.placement.orientation,
        displayId: a.look.displayId, scale: a.look.scale, wander: 0, path: null, pathId: 0, equipment: a.look.equipment, own: false, added: true, event: null, preset: a.look.preset,
      }),
    );
    const placedObjects = this.#layer.added.filter((a) => a.kind === 'gameobject').map(
      (a): ViewObject => ({
        guid: a.guid, entry: a.entry, name: a.name, map: a.map, x: a.placement.x, y: a.placement.y, z: a.placement.z,
        // Turned about Z by its facing unless it was tilted
        rotation: a.placement.rotation ?? [0, 0, Math.sin(a.placement.orientation / 2), Math.cos(a.placement.orientation / 2)],
        displayId: a.look.displayId, scale: a.look.scale, own: false, added: true, event: null,
      }),
    );
    return {
      creatures: [...spawns.creatures.filter((c) => !ownCreatures.has(c.guid) && shown(c)).map(creature), ...this.#own.creatures.filter(inBox), ...placedCreatures.filter(inBox)].map(pending),
      objects: [...spawns.objects.filter((o) => !ownObjects.has(o.guid) && shown(o)).map(object), ...this.#own.objects.filter(inBox), ...placedObjects.filter(inBox)],
      capped: spawns.capped,
    };
  }

  /** Draws the world layer's edits over the database's spawns and routes; routes still pending are dropped */
  async setWorldLayer(layer: WorldLayer) {
    this.#layer = layer;
    this.#pendingRoutes.clear();
    await this.#redraw();
  }

  /** Draws a route edited in the view until its host stores it (or says no, and it goes back) */
  async setPendingRoute(guid: number, points: ViewPoint[]) {
    this.#pendingRoutes.set(guid, points);
    await this.#redraw();
  }

  /** The ball drawn for one point of an NPC's route, or null when it is not drawn */
  routeBall(guid: number, point: number): THREE.Object3D | null {
    for (const group of this.#areas.values()) {
      for (const shown of group.getObjectByName('paths')?.children ?? []) {
        if (shown.userData.guid !== guid) continue;
        const ball = shown.children.find((child) => child.userData.point === point);
        if (ball) return ball;
      }
    }
    return null;
  }

  /** A drawn NPC's route as the view has it (with the layer's edits), or null when it has none */
  route(guid: number): { pathId: number; own: boolean; entry: number; points: ViewPoint[]; home: { x: number; y: number; z: number } } | null {
    for (const group of this.#areas.values()) {
      const creature: ViewCreature | undefined = group.userData.creatures?.get(guid);
      if (creature) {
        return creature.path && creature.path.length > 0
          ? { pathId: creature.pathId, own: creature.own, entry: creature.entry, points: creature.path, home: { x: creature.x, y: creature.y, z: creature.z } }
          : null;
      }
    }
    return null;
  }

  /** Which of an NPC's route points a ray passes within a yard of (the nearest along it), or null */
  pickRoutePoint(ray: THREE.Ray, guid: number): number | null {
    let best: { point: number; distance: number } | null = null;
    for (const group of this.#areas.values()) {
      for (const shown of group.getObjectByName('paths')?.children ?? []) {
        if (shown.userData.guid !== guid) continue;
        for (const ball of shown.children) {
          if (typeof ball.userData.point !== 'number' || ray.distanceSqToPoint(ball.position) > 1) continue;
          const distance = ray.origin.distanceTo(ball.position);
          if (!best || distance < best.distance) best = { point: ball.userData.point, distance };
        }
      }
    }
    return best ? best.point : null;
  }

  /** Hides or shows kinds without unloading them; taking event spawns in or out redraws the areas */
  async setVisibility(visibility: SpawnVisibility) {
    const redraw = visibility.events !== this.#visibility.events;
    this.#visibility = { ...DEFAULT_VISIBILITY, ...visibility };
    for (const group of this.#areas.values()) {
      this.#applyVisibility(group);
    }
    if (redraw) {
      await this.#redraw();
    }
  }

  /** Redraws every loaded area from its last answer, without asking again */
  async #redraw() {
    await Promise.all(
      [...this.#areas.entries()].map(([areaId, group]) => {
        const response = this.#responses.get(areaId);
        return response ? this.#fill(group, this.#overlay(response.spawns, response.box, response.map)) : null;
      }),
    );
  }

  /**
   * The nearest drawn spawn a ray passes through (by its bounds), or null. A spawn whose bounds hold
   * the ray's start (a building the camera is inside) is passed over, and so is one beyond `maxDistance`
   * (something solid, the ground or a wall, is in front of it).
   */
  pick(ray: THREE.Ray, maxDistance = Infinity): PickedSpawn | null {
    const hit = new THREE.Vector3();
    const hits: { spawn: THREE.Object3D; distance: number; bounds: THREE.Box3 }[] = [];
    for (const group of this.#areas.values()) {
      for (const name of ['creatures', 'objects']) {
        const kind = group.getObjectByName(name);
        if (!kind?.visible) continue;
        for (const spawn of kind.children) {
          if (!spawn.visible || !spawn.userData.spawn) continue;
          const bounds = spawnBounds(spawn, new THREE.Box3());
          if (bounds.isEmpty() || bounds.containsPoint(ray.origin) || !ray.intersectBox(bounds, hit)) continue;
          const distance = hit.distanceTo(ray.origin);
          if (distance <= maxDistance) hits.push({ spawn, distance, bounds });
        }
      }
    }
    if (hits.length === 0) return null;

    // The nearest box is a tent's before it is the NPC's inside it, so a spawn that stands inside
    // another's bounds (its centre does, and it is the smaller) wins over the one that holds it
    const nearest = (list: typeof hits) => list.reduce((a, b) => (b.distance < a.distance ? b : a));
    const volume = (box: THREE.Box3) => {
      const size = box.getSize(new THREE.Vector3());
      return size.x * size.y * size.z;
    };
    let best = nearest(hits);
    for (;;) {
      const held = hits.filter((h) => h !== best && best.bounds.containsPoint(h.bounds.getCenter(new THREE.Vector3())) && volume(h.bounds) < volume(best.bounds));
      if (held.length === 0) break;
      best = nearest(held);
    }
    return { ...best.spawn.userData.spawn, position: { ...best.spawn.userData.spawn.position } };
  }

  /** Marks a spawn as selected: an NPC's route and wander circle are drawn only while it is */
  setSelected(spawn: { kind: 'creature' | 'object'; guid: number } | null) {
    this.#selected = spawn ? { kind: spawn.kind, guid: spawn.guid } : null;
  }

  /** The drawn object of a spawn, or null when it is not drawn (its area unloaded, or it is hidden) */
  find(kind: 'creature' | 'object', guid: number): THREE.Object3D | null {
    for (const group of this.#areas.values()) {
      const shown = group.getObjectByName(kind === 'creature' ? 'creatures' : 'objects');
      if (!shown?.visible) continue;
      const spawn = shown.children.find((child) => child.userData.spawn?.guid === guid);
      if (spawn) return spawn.visible ? spawn : null;
    }
    return null;
  }

  /** Draws only the spawns within the draw distance of the camera; a hidden model stops animating */
  cull(cameraPosition: THREE.Vector3) {
    let grounding = GROUNDS_PER_FRAME;
    for (const group of this.#areas.values()) {
      for (const name of ['creatures', 'objects']) {
        for (const spawn of group.getObjectByName(name)?.children ?? []) {
          const near = spawn.position.distanceTo(cameraPosition) <= SPAWN_DRAW_DISTANCE;
          if (near && name === 'creatures' && grounding > 0 && this.#ground(spawn)) grounding -= 1;
          if (typeof spawn.show === 'function') {
            if (near) spawn.show();
            else spawn.hide();
          } else {
            spawn.visible = near;
          }
        }
      }
      // Only the selected NPC's route and wander circle, however far it has been left behind
      const selected = this.#selected?.kind === 'creature' ? this.#selected.guid : null;
      for (const shown of group.getObjectByName('paths')?.children ?? []) {
        shown.visible = shown.userData.guid === selected;
      }
    }
  }

  /**
   * Lifts an NPC that stands below the drawn ground onto it, once the ground is there to be found
   * (a few tries, for terrain still loading). Drawing only: the spawn's own position, which is what
   * the card shows and an edit writes, is not touched (see `userData.lift`). True when it asked.
   */
  #ground(spawn: THREE.Object3D): boolean {
    const data = spawn.userData;
    if (!this.#groundBelow || data.grounded || !data.spawn || spawn.name === 'marker') return false;
    const now = this.#now();
    if (data.groundAfter !== undefined && now < data.groundAfter) return false;
    const { x, y, z } = data.spawn.position;
    const found = this.#groundBelow(x, y, z + GROUND_REACH, GROUND_REACH);
    data.tries = (data.tries ?? 0) + 1;
    if (found === null && data.tries < GROUND_TRIES) {
      data.groundAfter = now + GROUND_RETRY_MS;
      return true;
    }
    data.grounded = true;
    const lift = found === null ? 0 : Math.min(Math.max(found - z, 0), GROUND_REACH);
    if (lift > 0.001) {
      data.lift = lift;
      spawn.position.z = z + lift;
      spawn.updateMatrixWorld(true);
    }
    return true;
  }

  /** Models animate through the shared model manager; nothing of the spawns' own moves yet */
  update(_deltaTime: number, _camera: THREE.Camera) {}

  async #draw(spawns: ViewSpawns) {
    const group = new THREE.Group();
    group.name = 'spawns';
    group.matrixAutoUpdate = false;
    await this.#fill(group, spawns);
    return group;
  }

  /**
   * Fills an area's group with its spawns, freeing what it held. The new spawns are made aside and
   * swapped in at the end; a fill overtaken by a later one frees what it made instead.
   */
  async #fill(group: THREE.Group, spawns: ViewSpawns) {
    const fill = (group.userData.fill ?? 0) + 1;
    group.userData.fill = fill;

    const creatures = new THREE.Group();
    creatures.name = 'creatures';
    const objects = new THREE.Group();
    objects.name = 'objects';
    const paths = new THREE.Group();
    paths.name = 'paths';
    const made = [creatures, objects, paths];

    const drawnCreatures = await Promise.all(
      spawns.creatures.map((creature) =>
        this.#drawSpawn('creature', creature, () => this.#resolver.creature(creature.displayId, creature.preset ?? null), creatureTransform(creature)),
      ),
    );
    for (const drawn of drawnCreatures) creatures.add(drawn);

    // How they move: patrol routes and wander circles, in world coordinates
    for (const creature of spawns.creatures) {
      // Each remembers whose it is, so it is drawn only while its NPC is selected
      for (const shown of [routeObject(creature), wanderObject(creature)]) {
        if (shown) {
          shown.userData.guid = creature.guid;
          shown.visible = false;
          paths.add(shown);
        }
      }
    }

    const drawnObjects = await Promise.all(
      spawns.objects.map((object) =>
        this.#drawSpawn('object', object, () => this.#resolver.object(object.displayId), objectTransform(object)),
      ),
    );
    for (const drawn of drawnObjects) objects.add(drawn);

    if (group.userData.fill !== fill) {
      for (const part of made) this.#release(part);
      return;
    }

    this.#release(group);
    group.clear();
    group.add(...made);
    // The creatures as drawn, so a route can be read back as the view has it
    group.userData.creatures = new globalThis.Map(spawns.creatures.map((c) => [c.guid, c]));
    this.#applyVisibility(group);
    group.updateMatrixWorld(true);
  }

  /**
   * Frees what spawns hold of their own: each model's animation (so it stops being animated) and
   * material, weapons with them, and route and wander lines. Shared marker, point and arrow geometry
   * and materials, and the models' shared geometry and textures, are kept.
   */
  #release(root: THREE.Object3D) {
    const owned: THREE.Object3D[] = [];
    root.traverse((object) => {
      if (object !== root) owned.push(object);
    });
    for (const object of owned) {
      if (typeof object.dispose === 'function') {
        object.dispose();
        for (const material of Array.isArray(object.material) ? object.material : object.material ? [object.material] : []) {
          material.dispose();
        }
      } else if (object instanceof THREE.Line) {
        object.geometry.dispose();
      }
    }
  }

  /** One spawn's model or building, placed; a marker when it cannot be drawn */
  async #drawSpawn(kind: 'creature' | 'object', spawn: ViewCreature | ViewObject, resolve: () => Promise<Look | null>, transform: Transform) {
    let drawn: THREE.Object3D | null = null;
    let lookScale = 1;
    try {
      let look = await resolve();
      // A dressed NPC wears the body texture built for it; without one, its bare skin stays
      if (look?.kind === 'model' && look.body && this.#bodyTexture) {
        const built = await this.#bodyTexture(look.body);
        if (built) look = { ...look, textures: { ...look.textures, 1: built } };
      }
      if (look) {
        lookScale = look.scale;
        drawn = look.kind === 'building' ? await this.#createBuilding(look.path) : await this.#createModel(look);
        if (look.kind === 'model' && look.attachments?.length && typeof drawn.attachmentObject === 'function') {
          await Promise.all(look.attachments.map((worn) => this.#wear(drawn, worn)));
        }
      } else if (spawn.displayId > 0) {
        this.#warnOnce(
          `${kind}:${spawn.displayId}`,
          `3D view: ${kind} ${spawn.guid} (display ${spawn.displayId}) has no model the client knows; drawn as a marker`,
        );
      }
    } catch (error) {
      this.#warnOnce(
        `${kind}:${spawn.displayId}`,
        `3D view: ${kind} ${spawn.guid} (display ${spawn.displayId}) could not be drawn: ${error instanceof Error ? error.message : String(error)}`,
      );
      drawn = null;
    }

    // Weapons in hand: main hand at attachment 1, off hand at 2; a ranged weapon is sheathed, not drawn
    if (drawn && kind === 'creature' && typeof drawn.attachmentObject === 'function') {
      const [mainHand, offHand] = (spawn as ViewCreature).equipment ?? [0, 0, 0];
      await Promise.all([[mainHand, 1], [offHand, 2]].map(([item, point]) => this.#hold(drawn, item, point)));
    }

    const object = drawn ?? this.#marker(kind);
    object.position.set(...transform.position);
    object.quaternion.set(...transform.quaternion);
    object.scale.setScalar(transform.scale * (drawn ? lookScale : 1));
    object.userData.spawn = {
      kind,
      guid: spawn.guid,
      entry: spawn.entry,
      name: spawn.name,
      own: spawn.own,
      added: spawn.added ?? false,
      pathId: kind === 'creature' ? ((spawn as ViewCreature).pathId ?? 0) : 0,
      event: spawn.event ?? null,
      position: { x: spawn.x, y: spawn.y, z: spawn.z },
    };
    return object;
  }

  /** A worn model (a helmet, a shoulder pad) at its attachment point; one that cannot be drawn is left off */
  async #wear(model, worn: { point: number; look: ModelLook }) {
    try {
      const point = model.attachmentObject(worn.point);
      if (point) point.add(await this.#createModel(worn.look));
    } catch (error) {
      this.#warnOnce(`worn:${worn.look.path}`, `3D view: ${worn.look.path} could not be drawn: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** A weapon in one of a model's hands; one that cannot be drawn is left out (the resolver says why) */
  async #hold(model, itemId: number, point: number) {
    if (!(itemId > 0)) return;
    try {
      const look = await this.#resolver.weapon(itemId);
      // A shield goes on the arm's shield point (0), whichever hand holds it
      const hand = look ? model.attachmentObject(look.shield ? SHIELD_POINT : point) : null;
      if (look && hand) hand.add(await this.#createModel(look));
    } catch (error) {
      this.#warnOnce(`item:${itemId}`, `3D view: item ${itemId} could not be drawn: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  #marker(kind: 'creature' | 'object') {
    const marker = new THREE.Mesh(markerGeometry, markerMaterials[kind]);
    marker.name = 'marker';
    return marker;
  }

  #applyVisibility(group: THREE.Group) {
    for (const name of ['creatures', 'objects', 'paths'] as const) {
      const child = group.getObjectByName(name);
      if (child) child.visible = this.#visibility[name];
    }
  }

  #warnOnce(key: string, message: string) {
    if (!this.#warned.has(key)) {
      this.#warned.add(key);
      console.warn(message);
    }
  }
}

export default SpawnManager;
export { SpawnManager, spawnBounds };
export type { PickedSpawn, SpawnSource, SpawnStatus, SpawnVisibility };

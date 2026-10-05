// @ts-nocheck
/**
 * The world's NPCs and objects in the 3D view: one group per loaded area (a 533-yard tile), like the
 * terrain, buildings and liquid. Each spawn is drawn with its display's model (or building), placed by
 * its position, facing and scale; one that cannot be drawn is a marker, logged once to the console.
 * Spawns come from a source (the world database through the app); a source that cannot give them
 * leaves the world drawn without them.
 */
import * as THREE from 'three';
import { withLooks, type EntityLooks } from '../../../../core/entities/view-spawns.js';
import { ViewCreature, ViewEvent, ViewObject, ViewPoint, ViewSpawns } from '../../../../core/db/view-spawns.js';
import { WorldLayer } from '../../../../core/world/layer.js';
import type { Movement } from '../../../../core/world/movement.js';
import type { Placement } from '../../../../core/world/layer.js';
import { BodyTexture, DisplayResolver, Look, ModelLook } from './DisplayResolver.js';
import { creatureTransform, objectTransform, Transform } from './placement.js';
import { moveRouteDrawing, routeObject, setBallSelected, wanderObject } from './paths.js';
import type { Candidates } from '../edit/box.js';
import type { SelectedPoint } from '../edit/selection.js';

type Box = { minX: number; maxX: number; minY: number; maxY: number };

/** What a drawn spawn says of itself: what a click picks, the card shows and an edit names */
const spawnDataOf = (kind: 'creature' | 'object', spawn: ViewCreature | ViewObject) => ({
  kind,
  guid: spawn.guid,
  entry: spawn.entry,
  name: spawn.name,
  own: spawn.own,
  added: spawn.added ?? false,
  pathId: kind === 'creature' ? ((spawn as ViewCreature).pathId ?? 0) : 0,
  event: spawn.event ?? null,
  position: { x: spawn.x, y: spawn.y, z: spawn.z },
});

/** A drawn spawn as the right-click menu sees it: what it is, how it moves, and where it stands as stored */
export type SpawnInfo = {
  kind: 'creature' | 'object';
  guid: number;
  entry: number;
  name: string;
  own: boolean;
  added: boolean;
  pathId: number;
  wander: number;
  map: number;
  placement: Placement;
  /** The spawn group it is in (as the world layer has the groups), or null */
  group: number | null;
  /** Seconds before it respawns */
  respawnSecs: number;
};

/** An object's facing: its turn about Z, from 0 to a whole turn */
const facingOf = ([, , z, w]: [number, number, number, number]): number => {
  const angle = 2 * Math.atan2(z, w);
  return angle < 0 ? angle + Math.PI * 2 : angle;
};

/** A creature as a movement moves it: its wander circle and which path it walks (the route is found by that path) */
const moved = (c: ViewCreature, m: Movement): ViewCreature => ({ ...c, wander: m.type === 'wander' ? m.wander : 0, pathId: m.pathId ?? 0, path: m.type === 'path' ? c.path : null });

/** What a spawn's model is made from; two spawns with the same key look the same */
const lookKeyOf = (kind: 'creature' | 'object', spawn: ViewCreature | ViewObject): string =>
  kind === 'creature'
    ? JSON.stringify([spawn.displayId, spawn.scale, (spawn as ViewCreature).equipment ?? null, (spawn as ViewCreature).preset ?? null])
    : JSON.stringify([spawn.displayId, spawn.scale]);

/** What an NPC's route and wander circle are drawn from */
const movesKeyOf = (c: ViewCreature): string => JSON.stringify([c.x, c.y, c.z, c.wander, c.own, c.path]);

/** An NPC's route and wander circle, each knowing whose it is, hidden until its NPC's route is active */
const movesOf = (creature: ViewCreature): THREE.Object3D[] =>
  [routeObject(creature), wanderObject(creature)].filter(Boolean).map((shown) => {
    shown.userData.guid = creature.guid;
    shown.visible = false;
    return shown;
  });

type SpawnSource = (map: number, box: Box) => Promise<ViewSpawns | { error: string }>;

/**
 * Which game event the world is drawn during: none (the everyday world), one event by id (its spawns
 * join the everyday ones, and those it takes away go), or all (every spawn the database has)
 */
type EventFilter = 'none' | 'all' | number;

/** Which spawns are drawn */
type SpawnVisibility = { creatures: boolean; objects: boolean; paths: boolean; events: EventFilter };

/** Whether a spawn is in the world while the filter's event runs */
const inEvent = (s: { event?: unknown; events?: { id: number }[]; removedBy?: { id: number }[] }, filter: EventFilter): boolean => {
  if (filter === 'all') return true;
  // A spawn read before events were listed has its one event only
  const brought = s.events ?? (s.event ? [s.event as { id: number }] : []);
  if (filter === 'none') return brought.length === 0;
  return (brought.length === 0 || brought.some((e) => e.id === filter)) && !(s.removedBy ?? []).some((e) => e.id === filter);
};

/** The events with spawns in these answers, those that bring spawns and those that take them away, by name */
const eventsIn = (answers: Iterable<{ spawns: ViewSpawns }>): ViewEvent[] => {
  const found = new globalThis.Map<number, ViewEvent>();
  for (const { spawns } of answers) {
    for (const s of [...spawns.creatures, ...spawns.objects]) {
      for (const e of [...(s.events ?? []), ...(s.removedBy ?? [])]) if (!found.has(e.id)) found.set(e.id, e);
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
};

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
type SpawnStatus = { capped: { creatures: boolean; objects: boolean }; error: string | null; loading?: number; events: ViewEvent[] };

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
const DEFAULT_VISIBILITY: SpawnVisibility = { creatures: true, objects: true, paths: true, events: 'none' };

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
  /** Looks of edited existing entities, drawn on their database spawns */
  #looks: EntityLooks = new globalThis.Map();
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
  /** NPCs' movement as edited in the view, drawn until the host stores it */
  #pendingMovements = new globalThis.Map<number, Movement>();

  /** The NPCs whose routes and wander circles are drawn: those being worked on */
  #activeRoutes = new globalThis.Set<number>();

  /** Picked route points, drawn larger and in the selection's colour */
  #marked = new globalThis.Set<string>();

  status: SpawnStatus = { capped: { creatures: false, objects: false }, error: null, events: [] };

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

    this.#responses.set(areaId, { map, box, spawns: answer });
    this.status = { capped: { ...answer.capped }, error: null, events: eventsIn(this.#responses.values()) };

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
    this.status = { ...this.status, events: eventsIn(this.#responses.values()) };
  }

  /** The looks of edited existing entities, drawn on their database spawns; loaded areas are redrawn */
  async setLooks(looks: EntityLooks) {
    this.#looks = looks;
    await this.#redraw();
  }

  /**
   * The open quest's own spawns, drawn in whichever loaded area holds them, in place of a database
   * spawn with the same guid. Loaded areas are redrawn from their last answer, without asking again.
   */
  async setOwnSpawns(spawns: ViewSpawns) {
    this.#own = spawns;
    this.#pendingRoutes.clear();
    this.#pendingMovements.clear();
    await this.#redraw();
  }

  /**
   * An area's database spawns as edited in the world layer (moved, turned, rerouted), less any the
   * open quest has its own of, plus its own in the box on its map; without event spawns unless they
   * are asked for
   */
  #overlay(rawSpawns: ViewSpawns, box: Box, map: number): ViewSpawns {
    const spawns = withLooks(rawSpawns, this.#looks);
    const inBox = (s: { map: number; x: number; y: number }) => s.map === map && s.x >= box.minX && s.x <= box.maxX && s.y >= box.minY && s.y <= box.maxY;
    const shown = (s: Parameters<typeof inEvent>[0]) => inEvent(s, this.#visibility.events);
    const ownCreatures = new Set(this.#own.creatures.map((c) => c.guid));
    const ownObjects = new Set(this.#own.objects.map((o) => o.guid));
    const placed = (kind: 'creature' | 'gameobject', guid: number) => this.#layer.spawns.find((s) => s.kind === kind && s.guid === guid)?.current;
    const routes = new globalThis.Map(this.#layer.routes.map((r) => [r.pathId, r.current]));
    const movements = new globalThis.Map((this.#layer.movements ?? []).map((m) => [m.guid, m.current]));
    // The layer's groups win over the database's: a spawn in one shows it, and one a layer group let go
    // of (or one in a group deleted there) is in none
    const layerGroups = this.#layer.groups ?? [];
    const inLayerGroup = new globalThis.Map<string, number>();
    for (const g of layerGroups) {
      if (g.removed) continue;
      for (const m of g.members) if (m.type === 'spawn') inLayerGroup.set(`${m.kind}:${m.guid}`, g.id);
    }
    const layerGroupIds = new Set(layerGroups.map((g) => g.id));
    const grouped = <T extends { guid: number; group?: number | null }>(kind: 'npc' | 'object', s: T): T => {
      const held = inLayerGroup.get(`${kind}:${s.guid}`);
      const was = s.group ?? null;
      const group = held ?? (was !== null && layerGroupIds.has(was) ? null : was);
      return group === was && 'group' in s ? s : { ...s, group };
    };
    const respawns = new globalThis.Map((this.#layer.respawns ?? []).map((r) => [`${r.kind}:${r.guid}`, r.current]));
    // The layer's respawn time over the database's
    const timed = <T extends ViewCreature | ViewObject>(kind: 'creature' | 'gameobject', s: T): T => {
      const secs = respawns.get(`${kind}:${s.guid}`);
      return secs === undefined ? s : { ...s, respawnSecs: secs };
    };
    // The layer's movement first, so a new path is found by its id among the layer's routes
    const routed = (c: ViewCreature): ViewCreature => {
      const movement = movements.get(c.guid);
      const walks = movement ? moved(c, movement) : c;
      const route = walks.pathId > 0 ? routes.get(walks.pathId) : undefined;
      return route ? { ...walks, path: route.map((p): ViewPoint => ({ x: p.x, y: p.y, z: p.z, carry: p.rest })) } : walks;
    };
    const creature = (c: ViewCreature): ViewCreature => {
      const at = placed('creature', c.guid);
      return grouped('npc', routed(timed('creature', at ? { ...c, x: at.x, y: at.y, z: at.z, orientation: at.orientation } : c)));
    };
    const pending = (c: ViewCreature): ViewCreature => {
      const movement = this.#pendingMovements.get(c.guid);
      const walks = movement ? moved(c, movement) : c;
      const route = this.#pendingRoutes.get(c.guid);
      return route ? { ...walks, path: route } : walks;
    };
    const object = (o: ViewObject): ViewObject => {
      const at = placed('gameobject', o.guid);
      return grouped('object', timed('gameobject', at ? { ...o, x: at.x, y: at.y, z: at.z, ...(at.rotation ? { rotation: at.rotation } : {}) } : o));
    };
    // Spawns placed in the view, drawn as their template looked when they were placed
    const placedCreatures = this.#layer.added.filter((a) => a.kind === 'creature').map(
      (a): ViewCreature => ({
        guid: a.guid, entry: a.entry, name: a.name, map: a.map, x: a.placement.x, y: a.placement.y, z: a.placement.z, orientation: a.placement.orientation,
        displayId: a.look.displayId, scale: a.look.scale, wander: 0, path: null, pathId: 0, equipment: a.look.equipment, own: false, added: true, event: null, events: [], removedBy: [], preset: a.look.preset, group: null,
        respawnSecs: a.respawnSecs ?? 300,
      }),
    );
    const placedObjects = this.#layer.added.filter((a) => a.kind === 'gameobject').map(
      (a): ViewObject => ({
        guid: a.guid, entry: a.entry, name: a.name, map: a.map, x: a.placement.x, y: a.placement.y, z: a.placement.z,
        // Turned about Z by its facing unless it was tilted
        rotation: a.placement.rotation ?? [0, 0, Math.sin(a.placement.orientation / 2), Math.cos(a.placement.orientation / 2)],
        displayId: a.look.displayId, scale: a.look.scale, own: false, added: true, event: null, events: [], removedBy: [], group: null,
        respawnSecs: a.respawnSecs ?? 300,
      }),
    );
    return {
      creatures: [
        ...spawns.creatures.filter((c) => !ownCreatures.has(c.guid) && shown(c)).map(creature),
        ...this.#own.creatures.filter(inBox).map((c) => grouped('npc', c)),
        ...placedCreatures.filter(inBox).map((c) => grouped('npc', routed(c))),
      ].map(pending),
      objects: [
        ...spawns.objects.filter((o) => !ownObjects.has(o.guid) && shown(o)).map(object),
        ...this.#own.objects.filter(inBox).map((o) => grouped('object', o)),
        ...placedObjects.filter(inBox).map((o) => grouped('object', o)),
      ],
      capped: spawns.capped,
    };
  }

  /** Draws the world layer's edits over the database's spawns and routes; routes still pending are dropped */
  async setWorldLayer(layer: WorldLayer) {
    this.#layer = layer;
    this.#pendingRoutes.clear();
    this.#pendingMovements.clear();
    await this.#redraw();
  }

  /** Draws an NPC's movement as edited in the view until its host stores it; null draws it as stored */
  async setPendingMovement(guid: number, movement: Movement | null) {
    if (movement) this.#pendingMovements.set(guid, movement);
    else this.#pendingMovements.delete(guid);
    await this.#redraw();
  }

  /** A drawn NPC as the view has it (with the layer's and pending edits), or undefined */
  #creature(guid: number): ViewCreature | undefined {
    for (const group of this.#areas.values()) {
      const creature: ViewCreature | undefined = group.userData.creatures?.get(guid);
      if (creature) return creature;
    }
    return undefined;
  }

  /** How a drawn NPC moves, as the view has it; null when it is not drawn */
  movement(guid: number): Movement | null {
    const creature = this.#creature(guid);
    if (!creature) return null;
    const pathId = creature.pathId > 0 ? creature.pathId : null;
    if (creature.path && creature.path.length > 0) return { type: 'path', wander: 0, pathId };
    return creature.wander > 0 ? { type: 'wander', wander: creature.wander, pathId } : { type: 'idle', wander: 0, pathId };
  }

  /** A drawn spawn as the right-click menu describes it, or null when it is not drawn */
  info(kind: 'creature' | 'object', guid: number): SpawnInfo | null {
    for (const group of this.#areas.values()) {
      const data: ViewCreature | ViewObject | undefined = (kind === 'creature' ? group.userData.creatures : group.userData.objects)?.get(guid);
      if (!data) continue;
      const base = { kind, guid, entry: data.entry, name: data.name, own: data.own, added: data.added ?? false, map: data.map, group: data.group ?? null, respawnSecs: data.respawnSecs ?? 300 };
      if (kind === 'creature') {
        const c = data as ViewCreature;
        return { ...base, pathId: c.pathId ?? 0, wander: c.wander, placement: { x: c.x, y: c.y, z: c.z, orientation: c.orientation, rotation: null } };
      }
      const o = data as ViewObject;
      return { ...base, pathId: 0, wander: 0, placement: { x: o.x, y: o.y, z: o.z, orientation: facingOf(o.rotation), rotation: o.rotation } };
    }
    return null;
  }

  /** Draws a route edited in the view until its host stores it (or says no, and it goes back) */
  async setPendingRoute(guid: number, points: ViewPoint[]) {
    this.#pendingRoutes.set(guid, points);
    await this.#redraw();
  }

  /**
   * A drawn NPC's route as the view has it (with the layer's edits, and as edited in the view while
   * that waits to be stored, before the redraw), or null when it has none
   */
  route(guid: number): { pathId: number; own: boolean; entry: number; points: ViewPoint[]; home: { x: number; y: number; z: number } } | null {
    for (const group of this.#areas.values()) {
      const creature: ViewCreature | undefined = group.userData.creatures?.get(guid);
      if (creature) {
        const points = this.#pendingRoutes.get(guid) ?? creature.path;
        return points && points.length > 0
          ? { pathId: creature.pathId, own: creature.own, entry: creature.entry, points, home: { x: creature.x, y: creature.y, z: creature.z } }
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
        return response ? this.#patch(group, this.#overlay(response.spawns, response.box, response.map)) : null;
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

  /** The NPCs whose routes are worked on: an NPC's route and wander circle are drawn only while it is one */
  setActiveRoutes(guids: number[]) {
    this.#activeRoutes = new globalThis.Set(guids);
  }

  /** The picked route points, marked on their routes */
  markPoints(points: SelectedPoint[]) {
    this.#marked = new globalThis.Set(points.map((p) => `${p.guid}:${p.index}`));
  }

  /**
   * What a selection box can catch: the points of the drawn routes, and the drawn NPCs and objects
   * of the shown kinds within draw distance, each at the middle of its bounds
   */
  candidates(cameraPosition: THREE.Vector3): Candidates {
    const points: Candidates['points'] = [];
    const spawns: Candidates['spawns'] = [];
    for (const group of this.#areas.values()) {
      const paths = group.getObjectByName('paths');
      for (const shown of paths?.visible ? paths.children : []) {
        if (!shown.visible) continue;
        for (const ball of shown.children) {
          if (typeof ball.userData.point === 'number') points.push({ guid: shown.userData.guid, index: ball.userData.point, at: ball.position.clone() });
        }
      }
      for (const name of ['creatures', 'objects']) {
        const kind = group.getObjectByName(name);
        if (!kind?.visible) continue;
        for (const spawn of kind.children) {
          if (!spawn.visible || !spawn.userData.spawn || spawn.position.distanceTo(cameraPosition) > SPAWN_DRAW_DISTANCE) continue;
          const bounds = spawnBounds(spawn, new THREE.Box3());
          const at = bounds.isEmpty() ? spawn.position.clone() : bounds.getCenter(new THREE.Vector3());
          spawns.push({ kind: spawn.userData.spawn.kind, guid: spawn.userData.spawn.guid, at });
        }
      }
    }
    return { points, spawns };
  }

  /** Moves an NPC's drawn route to points being dragged, without drawing its area again */
  previewRoute(guid: number, points: ViewPoint[]) {
    for (const group of this.#areas.values()) {
      const creature: ViewCreature | undefined = group.userData.creatures?.get(guid);
      if (!creature) continue;
      for (const shown of group.getObjectByName('paths')?.children ?? []) {
        if (shown.userData.guid === guid && shown.name === 'route') {
          shown.userData.previewed = true;
          moveRouteDrawing(shown, { x: creature.x, y: creature.y, z: creature.z }, points);
        }
      }
    }
  }

  /** Takes an NPC's route (its first leg) and wander circle to where it is being dragged, without drawing its area again */
  previewHome(guid: number, at: { x: number; y: number; z: number }) {
    for (const group of this.#areas.values()) {
      const creature: ViewCreature | undefined = group.userData.creatures?.get(guid);
      if (!creature) continue;
      for (const shown of group.getObjectByName('paths')?.children ?? []) {
        if (shown.userData.guid !== guid) continue;
        // Drawn from the next redraw's data again, whatever it says
        shown.userData.previewed = true;
        if (shown.name === 'route') {
          const points = this.#pendingRoutes.get(guid) ?? creature.path;
          if (points?.length) moveRouteDrawing(shown, at, points);
        } else {
          // A wander circle is drawn round where the NPC stood: shifted by how far it has gone
          shown.position.set(at.x - creature.x, at.y - creature.y, at.z - creature.z);
          shown.updateMatrixWorld(true);
        }
      }
    }
  }

  /** A drawn spawn as a click would pick it, or null when it is not drawn */
  picked(kind: 'creature' | 'object', guid: number): PickedSpawn | null {
    const spawn = this.find(kind, guid);
    return spawn ? { ...spawn.userData.spawn, position: { ...spawn.userData.spawn.position } } : null;
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
      // Only the active routes and wander circles, however far they have been left behind; picked points marked
      for (const shown of group.getObjectByName('paths')?.children ?? []) {
        shown.visible = this.#activeRoutes.has(shown.userData.guid);
        if (!shown.visible || shown.name !== 'route') continue;
        for (const ball of shown.children) {
          if (typeof ball.userData.point !== 'number') continue;
          const marked = this.#marked.has(`${shown.userData.guid}:${ball.userData.point}`);
          if (marked !== (ball.userData.marked === true)) {
            ball.userData.marked = marked;
            setBallSelected(ball, marked);
          }
        }
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
    for (const creature of spawns.creatures) paths.add(...movesOf(creature));

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
    // The creatures as drawn, so a route can be read back as the view has it, and the objects for the menu
    group.userData.creatures = new globalThis.Map(spawns.creatures.map((c) => [c.guid, c]));
    group.userData.objects = new globalThis.Map(spawns.objects.map((o) => [o.guid, o]));
    this.#applyVisibility(group);
    group.updateMatrixWorld(true);
  }

  /**
   * Brings an area's drawn spawns up to date with what it should show, changing only what differs, so
   * an edit shows at once and costs only itself: a spawn that moved or turned is moved; one that is new,
   * or whose look changed, is drawn and swapped in once ready (until then the old one stands in, already
   * moved); one no longer there is taken out; only the routes and wander circles that changed are drawn
   * again. An area not yet filled is filled whole.
   */
  async #patch(group: THREE.Group, spawns: ViewSpawns) {
    const containers = { creature: group.getObjectByName('creatures'), object: group.getObjectByName('objects') };
    const paths = group.getObjectByName('paths');
    if (!containers.creature || !containers.object || !paths) {
      await this.#fill(group, spawns);
      return;
    }
    const fill = (group.userData.fill ?? 0) + 1;
    group.userData.fill = fill;

    const drawing: Promise<{ container: THREE.Object3D; made: THREE.Object3D; old: THREE.Object3D | undefined }>[] = [];
    const sync = (kind: 'creature' | 'object', list: (ViewCreature | ViewObject)[]) => {
      const container = containers[kind];
      const drawn = new globalThis.Map(container.children.map((c) => [c.userData.spawn.guid, c]));
      const wanted = new globalThis.Set<number>();
      for (const spawn of list) {
        wanted.add(spawn.guid);
        const transform = kind === 'creature' ? creatureTransform(spawn) : objectTransform(spawn);
        const old = drawn.get(spawn.guid);
        if (old) this.#place(old, kind, spawn, transform);
        if (old && old.userData.lookKey === lookKeyOf(kind, spawn)) continue;
        const resolve = kind === 'creature' ? () => this.#resolver.creature(spawn.displayId, spawn.preset ?? null) : () => this.#resolver.object(spawn.displayId);
        drawing.push(this.#drawSpawn(kind, spawn, resolve, transform).then((made) => ({ container, made, old })));
      }
      for (const [guid, object] of drawn) {
        if (!wanted.has(guid)) this.#remove(object);
      }
    };
    sync('creature', spawns.creatures);
    sync('object', spawns.objects);

    // Routes and wander circles: drawn again only for NPCs whose route, place or wander changed
    const before: globalThis.Map<number, ViewCreature> = group.userData.creatures ?? new globalThis.Map();
    const now = new globalThis.Map(spawns.creatures.map((c) => [c.guid, c]));
    const changed = new globalThis.Set<number>();
    for (const [guid, creature] of now) if (movesKeyOf(creature) !== (before.has(guid) ? movesKeyOf(before.get(guid)!) : null)) changed.add(guid);
    for (const guid of before.keys()) if (!now.has(guid)) changed.add(guid);
    // Moved while dragging: drawn again from the data, which may not have taken the move
    for (const shown of paths.children) if (shown.userData.previewed) changed.add(shown.userData.guid);
    for (const shown of [...paths.children]) if (changed.has(shown.userData.guid)) this.#remove(shown);
    for (const guid of changed) {
      const creature = now.get(guid);
      if (creature) paths.add(...movesOf(creature));
    }
    // The creatures as drawn, so a route can be read back as the view has it, and the objects for the menu
    group.userData.creatures = now;
    group.userData.objects = new globalThis.Map(spawns.objects.map((o) => [o.guid, o]));
    this.#applyVisibility(group);
    group.updateMatrixWorld(true);

    const made = await Promise.all(drawing);
    if (group.userData.fill !== fill) {
      for (const { made: object } of made) this.#remove(object);
      return;
    }
    for (const { container, made: object, old } of made) {
      if (old) this.#remove(old);
      container.add(object);
    }
    group.updateMatrixWorld(true);
  }

  /** A drawn spawn put where it now stands, and turned; one that moved is stood on the ground again from there */
  #place(object: THREE.Object3D, kind: 'creature' | 'object', spawn: ViewCreature | ViewObject, transform: Transform) {
    const data = object.userData;
    const was = data.spawn.position;
    const moved = was.x !== spawn.x || was.y !== spawn.y || was.z !== spawn.z;
    data.spawn = spawnDataOf(kind, spawn);
    if (moved) {
      data.lift = 0;
      data.grounded = false;
      data.tries = 0;
      data.groundAfter = undefined;
    }
    object.position.set(transform.position[0], transform.position[1], transform.position[2] + (data.lift ?? 0));
    object.quaternion.set(...transform.quaternion);
    object.updateMatrixWorld(true);
  }

  /** Takes one drawn thing out of its group and frees what it holds of its own */
  #remove(object: THREE.Object3D) {
    object.removeFromParent();
    const holder = new THREE.Group();
    holder.add(object);
    this.#release(holder);
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
    object.userData.spawn = spawnDataOf(kind, spawn);
    // What it was drawn from: a change to any of it means drawing it again, not just moving it
    object.userData.lookKey = lookKeyOf(kind, spawn);
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
export type { EventFilter, PickedSpawn, SpawnSource, SpawnStatus, SpawnVisibility };

/**
 * The world's NPCs and objects in the 3D view: one group per loaded area (a 533-yard tile), like the
 * terrain, buildings and liquid. Each spawn is drawn with its display's model (or building), placed by
 * its position, facing and scale; one that cannot be drawn is a marker, logged once to the console.
 * Spawns come from a source (the world database through the app); a source that cannot give them
 * leaves the world drawn without them.
 */
import * as THREE from 'three';
import { withLooks, type EntityLooks } from '../../../../core/entities/view-spawns.js';
import { PoolEvent, ViewCreature, ViewEvent, ViewObject, ViewPoint, ViewSpawns } from '../../../../core/db/view-spawns.js';
import { WorldLayer } from '../../../../core/world/layer.js';
import type { Movement } from '../../../../core/world/movement.js';
import type { Placement } from '../../../../core/world/layer.js';
import type { SpawnEvents } from '../../../../core/entities/model.js';
import { BodyTexture, DisplayResolver, Look, ModelLook } from './DisplayResolver.js';
import { creatureTransform, objectTransform, Transform } from './placement.js';
import { Frame, IDENTITY_FRAME, placementToWorld } from '../../../../core/map/transport-frame.js';
import { framePaths, moveRouteDrawing, routeObject, setBallSelected, wanderObject } from './paths.js';
import { MovementControl } from './movement-control.js';
import { Walkers } from './walkers.js';
import type { Activity } from './MovementDriver.js';
import { GROUND_REACH } from '../../../../core/world/walk/tuning.js';
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
  /** Where it stands in the view: on a vessel, its row's place carried by the vessel's frame */
  placement: Placement;
  /** The spawn group it is in (as the world layer has the groups), or null */
  group: number | null;
  /** Seconds before it respawns */
  respawnSecs: number;
  /** An NPC's own game events as the project sets them; absent follows its NPC */
  spawnEvents?: SpawnEvents;
  /** The game events an NPC is drawn by now: there only during these, gone during those */
  eventsNow?: { during: ViewEvent[]; gone: ViewEvent[] };
  /** An object's template type (3 is a chest); absent for an NPC or when it is not known */
  objectType?: number;
  /** An NPC's template `npcflag` (128 is a vendor); absent for an object or when it is not known */
  npcFlags?: number;
  /** An NPC's template `gossip_menu_id` (0 has no menu); absent for an object or when it is not known */
  gossipMenuId?: number;
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
  [routeObject(creature), wanderObject(creature)].filter((shown): shown is NonNullable<typeof shown> => shown !== null).map((shown) => {
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

/**
 * What a drawn model (the vendored `Model`) offers beyond an `Object3D`: its attachment points, showing
 * and hiding (which also stops it animating), and freeing what it holds. A building or marker has none.
 */
type DrawnModel = THREE.Object3D & {
  attachmentObject?(point: number): THREE.Object3D | null;
  show?(): void;
  hide?(): void;
  dispose?(): void;
  material?: THREE.Material | THREE.Material[];
};
/** A drawn model that has attachment points, so it can hold weapons and wear helmets */
type Holder = DrawnModel & { attachmentObject(point: number): THREE.Object3D | null };
const canHold = (object: DrawnModel | null): object is Holder => typeof object?.attachmentObject === 'function';

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
  /** The vessel the spawns' rows are local to (default: none, rows are in the world) */
  frame?: Frame;
  /** Whether the NPCs walk, shared by every manager of a scene (default: a control of its own, paused) */
  movement?: MovementControl;
};

/** Whether a frame leaves every place where it is */
const isIdentity = (frame: Frame): boolean => frame.x === 0 && frame.y === 0 && frame.z === 0 && frame.heading === 0;

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

/**
 * Spawns further than this from the camera are not drawn. Five times the game's (about 100 yards), so
 * they stay while zoomed out over a route; an NPC whose route is worked on is drawn whatever the distance.
 */
const SPAWN_DRAW_DISTANCE = 500;

/** M2 attachment points: a shield on the arm, weapons in the right (1) and left (2) hands */
const SHIELD_POINT = 0;

/** How long to wait before asking again for an area whose answer failed */
const RETRY_MS = 30000;

/** Where the ground is not there yet (its terrain still loading), asked again this often, this many times */
const GROUND_RETRY_MS = 2000;
const GROUND_TRIES = 4;
/** NPCs grounded in one frame at most, so a crowd coming into range does not stall it */
const GROUNDS_PER_FRAME = 16;

/**
 * A model's bounding sphere is of its resting pose; widened by this much (and these yards), it holds
 * the model as it moves and what it wears or holds, for telling whether the camera looks at it
 */
const VIEW_SPHERE_SCALE = 1.5;
const VIEW_SPHERE_PAD = 2;
const viewSphere = new THREE.Sphere();

/** What an NPC wears or holds (helmets, shoulders, weapons) is left off further than this: a few pixels, a draw call each */
const WORN_DETAIL_DISTANCE = 150;

/** The models an NPC wears or holds, at its attachment points; worked out once a drawn NPC */
function wornOf(spawn: THREE.Object3D): THREE.Object3D[] {
  let worn: THREE.Object3D[] | undefined = spawn.userData.worn;
  if (!worn) {
    worn = spawn.children.filter((child) => child.name.startsWith('attachment:')).flatMap((point) => point.children);
    spawn.userData.worn = worn;
  }
  return worn;
}

/** Shows or hides what an NPC wears; a hidden model stops animating */
function showWorn(spawn: THREE.Object3D, shown: boolean) {
  if (spawn.userData.wornShown === shown) return;
  spawn.userData.wornShown = shown;
  for (const model of wornOf(spawn)) {
    if (typeof (model as any).show === 'function') {
      if (shown) (model as any).show();
      else (model as any).hide();
    } else {
      model.visible = shown;
    }
  }
}

/**
 * Each geometry's bounds from its own vertices, kept once worked out. A model's stored bounds take in
 * the reach of every animation it has, which for a guard is a box thirty yards wide.
 */
const vertexBounds = new WeakMap<THREE.BufferGeometry, THREE.Box3>();
const boundsOf = (geometry: THREE.BufferGeometry): THREE.Box3 => {
  let bounds = vertexBounds.get(geometry);
  if (!bounds) {
    const position = geometry.getAttribute('position');
    bounds = position ? new THREE.Box3().setFromBufferAttribute(position as THREE.BufferAttribute) : new THREE.Box3();
    vertexBounds.set(geometry, bounds);
  }
  return bounds;
};

/** A drawn spawn's bounds in the world, as it stands (with what it holds), into `target` */
/**
 * An area's creatures, objects or paths: a direct child, looked up as one. `getObjectByName` searches
 * depth first, through every NPC model and what it wears, and ran several times an area every frame.
 */
function holderOf(group: THREE.Object3D, name: 'creatures' | 'objects' | 'paths'): THREE.Object3D | undefined {
  return group.children.find((child) => child.name === name);
}

/** Whether the camera looks at a spawn: a model by its widened bounding sphere; anything else is taken as seen */
function inView(spawn: THREE.Object3D, frustum: THREE.Frustum): boolean {
  const sphere: THREE.Sphere | undefined = (spawn as any).boundingSphereWorld;
  if (!sphere) return true;
  viewSphere.center.copy(sphere.center);
  viewSphere.radius = sphere.radius * VIEW_SPHERE_SCALE + VIEW_SPHERE_PAD;
  return frustum.intersectsSphere(viewSphere);
}

function spawnBounds(spawn: THREE.Object3D, target: THREE.Box3): THREE.Box3 {
  const part = new THREE.Box3();
  target.makeEmpty();
  spawn.traverseVisible((object) => {
    const geometry = (object as THREE.Mesh).geometry;
    if (geometry) target.union(part.copy(boundsOf(geometry)).applyMatrix4(object.matrixWorld));
  });
  return target;
}

/**
 * A drawn spawn's bounds in its own frame, into `target`: as big as the model however it is turned, so
 * drawn with the spawn's matrix they hug it, where `spawnBounds` is the wider box round it in the world
 */
function spawnLocalBounds(spawn: THREE.Object3D, target: THREE.Box3): THREE.Box3 {
  const part = new THREE.Box3();
  const toSpawn = new THREE.Matrix4().copy(spawn.matrixWorld).invert();
  const inSpawn = new THREE.Matrix4();
  target.makeEmpty();
  spawn.traverseVisible((object) => {
    const geometry = (object as THREE.Mesh).geometry;
    if (geometry) target.union(part.copy(boundsOf(geometry)).applyMatrix4(inSpawn.multiplyMatrices(toSpawn, object.matrixWorld)));
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
  /** Areas whose group is shown and still being filled as models get made */
  #filling = new globalThis.Map<number, THREE.Group>();
  /** Where the camera last was, for starting with the spawns nearest it */
  #focus = new THREE.Vector3();
  #focused = false;
  #requests = 0;
  #visibility: SpawnVisibility = { ...DEFAULT_VISIBILITY };
  /** Looks of edited existing entities, drawn on their database spawns */
  #looks: EntityLooks = new globalThis.Map();
  #own: ViewSpawns = { creatures: [], objects: [], capped: { creatures: false, objects: false } };
  #warned = new Set<string>();
  #now: () => number;
  #groundBelow: SpawnManagerOptions['groundBelow'];
  /** The vessel rows are local to: each spawn is drawn at its row's place carried by this */
  #frame: Frame;
  /** The vessel itself, drawn at the frame; no part of any area, never picked or edited */
  readonly decor = new THREE.Group();
  /** Rises with each `setVessel`: a vessel still loading when another was asked for is dropped */
  #vessels = 0;
  /** Areas whose answer failed, and when they may be asked for again */
  #failed = new globalThis.Map<number, number>();

  /** Edits to database spawns and routes, drawn over what the database has */
  #layer: WorldLayer = { spawns: [], routes: [], added: [] };

  /**
   * Every spawn under each top-level layer group with an event, through all its levels (database groups
   * the loaded spawns do not name among them), by group id
   */
  #groupSpawns: ReadonlyMap<number, readonly { kind: 'npc' | 'object'; guid: number }[]> = new globalThis.Map();

  /** Routes edited in the view and not yet stored by its host, drawn in place of what it has */
  #pendingRoutes = new globalThis.Map<number, ViewPoint[]>();
  /** NPCs' movement as edited in the view, drawn until the host stores it */
  #pendingMovements = new globalThis.Map<number, Movement>();

  /** The NPCs whose routes and wander circles are drawn: those being worked on */
  #activeRoutes = new globalThis.Set<number>();

  /** Picked route points, drawn larger and in the selection's colour */
  #marked = new globalThis.Set<string>();

  /** The drawn NPCs walking their paths and wander circles */
  #walkers: Walkers;

  status: SpawnStatus = { capped: { creatures: false, objects: false }, error: null, events: [] };

  constructor(options: SpawnManagerOptions) {
    this.#resolver = options.resolver;
    this.#createModel = options.createModel;
    this.#createBuilding = options.createBuilding;
    this.#bodyTexture = options.bodyTexture;
    this.#source = options.source;
    this.#now = options.now ?? Date.now;
    this.#groundBelow = options.groundBelow;
    this.#frame = options.frame ?? IDENTITY_FRAME;
    this.decor.name = 'decor';
    this.#walkers = new Walkers(options.movement ?? new MovementControl(), {
      frame: () => this.#frame,
      // On a vessel, NPCs walk its flat deck: the ground below is not theirs
      ground: () => (isIdentity(this.#frame) ? this.#groundBelow : undefined),
    });
  }

  /** The row's drawn place: its own, carried by the frame */
  #transformOf(kind: 'creature' | 'object', spawn: ViewCreature | ViewObject): Transform {
    if (isIdentity(this.#frame)) return kind === 'creature' ? creatureTransform(spawn as ViewCreature) : objectTransform(spawn as ViewObject);
    const row = spawn as ViewCreature & ViewObject;
    const world = placementToWorld(this.#frame, {
      x: spawn.x,
      y: spawn.y,
      z: spawn.z,
      orientation: kind === 'creature' ? row.orientation || 0 : 0,
      rotation: kind === 'object' ? row.rotation : null,
    });
    return kind === 'creature'
      ? creatureTransform({ ...world, scale: spawn.scale })
      : objectTransform({ ...world, rotation: world.rotation ?? row.rotation, scale: spawn.scale });
  }

  /** Moves the vessel, and with it every drawn spawn and the vessel's own model, to a new frame */
  setFrame(frame: Frame) {
    this.#frame = frame;
    for (const group of this.#areas.values()) {
      for (const [name, kind] of [['creatures', 'creature'], ['objects', 'object']] as const) {
        for (const drawn of holderOf(group, name)?.children ?? []) {
          const row = drawn.userData.row;
          if (!row) continue;
          const data = drawn.userData;
          data.lift = 0;
          data.grounded = false;
          data.tries = 0;
          data.groundAfter = undefined;
          const transform = this.#transformOf(kind, row);
          drawn.position.set(...transform.position);
          drawn.quaternion.set(...transform.quaternion);
          drawn.updateMatrixWorld(true);
          // A walking NPC is put back where it has walked to, on the vessel where it now is
          if (kind === 'creature') this.#walkers.refresh(drawn);
        }
      }
      this.#applyVisibility(group);
      framePaths(holderOf(group, 'paths')!, frame);
      group.updateMatrixWorld(true);
    }
    this.#placeVessel();
  }

  /** Draws the vessel's building or model at the frame, in place of the last; null takes it away */
  async setVessel(vessel: { displayId: number } | null): Promise<void> {
    const turn = ++this.#vessels;
    for (const old of [...this.decor.children]) this.#remove(old);
    if (!vessel) return;
    let drawn: THREE.Object3D | null = null;
    let scale = 1;
    try {
      const look = await this.#resolver.object(vessel.displayId);
      if (look) {
        scale = look.scale;
        drawn = look.kind === 'building' ? await this.#createBuilding(look.path) : await this.#createModel(look);
      } else {
        this.#warnOnce(`vessel:${vessel.displayId}`, `3D view: vessel (display ${vessel.displayId}) has no model the client knows; left out`);
      }
    } catch (error) {
      this.#warnOnce(`vessel:${vessel.displayId}`, `3D view: vessel (display ${vessel.displayId}) could not be drawn: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!drawn) return;
    if (this.#vessels !== turn) {
      this.#remove(drawn);
      return;
    }
    drawn.scale.setScalar(scale);
    this.decor.add(drawn);
    this.#placeVessel();
  }

  #placeVessel() {
    const frame = this.#frame;
    for (const drawn of this.decor.children) {
      drawn.position.set(frame.x, frame.y, frame.z);
      drawn.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), frame.heading);
      drawn.updateMatrixWorld(true);
    }
  }

  /** Areas asked for and not yet drawn (their spawns on their way, or their models loading) */
  get loading(): number {
    let count = 0;
    for (const areaId of this.#wanted.keys()) if (!this.#areas.has(areaId) || this.#filling.has(areaId)) count += 1;
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

  /**
   * An area's spawns as a group, or null when it was removed meanwhile. The group is handed to `show` as soon as
   * the area's rows are in, empty; each spawn is added as its model is ready, the ones nearest the camera
   * first. The group is returned once all are.
   */
  async loadArea(areaId: number, map: number, box: Box, show?: (group: THREE.Group) => void): Promise<THREE.Group | null> {
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

    const group = this.#empty();
    this.#areas.set(areaId, group);
    this.#filling.set(areaId, group);
    show?.(group);
    try {
      await this.#patch(group, this.#overlay(answer, box, map));
    } finally {
      if (this.#filling.get(areaId) === group) this.#filling.delete(areaId);
    }
    return this.#wanted.get(areaId) === request ? group : null;
  }

  /** Drops an area's spawns and frees them; an answer still on its way for it is dropped too */
  removeArea(areaId: number) {
    const group = this.#areas.get(areaId);
    if (group) {
      group.userData.fill = (group.userData.fill ?? 0) + 1;
      for (const drawn of holderOf(group, 'creatures')?.children ?? []) this.#walkers.untrack(drawn);
      this.#release(group);
      group.clear();
    }
    this.#wanted.delete(areaId);
    this.#responses.delete(areaId);
    this.#areas.delete(areaId);
    this.#filling.delete(areaId);
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
    const eventNames = new globalThis.Map(this.status.events.map((e) => [e.id, e.name]));
    const ownCreatures = new Set(this.#own.creatures.map((c) => c.guid));
    const ownObjects = new Set(this.#own.objects.map((o) => o.guid));
    // Database spawns the layer deletes are not drawn
    const deleted = new Set((this.#layer.deletes ?? []).map((d) => `${d.kind}:${d.guid}`));
    const placed = (kind: 'creature' | 'gameobject', guid: number) => this.#layer.spawns.find((s) => s.kind === kind && s.guid === guid)?.current;
    const routes = new globalThis.Map(this.#layer.routes.map((r) => [r.pathId, r.current]));
    const movements = new globalThis.Map((this.#layer.movements ?? []).map((m) => [m.guid, m.current]));
    // The layer's groups win over the database's: a spawn in one shows it, and one a layer group let go
    // of (or one in a group deleted there) is in none
    const layerGroups = this.#layer.groups ?? [];
    const inLayerGroup = new globalThis.Map<string, number>();
    const liveGroups = new globalThis.Map<number, (typeof layerGroups)[number]>();
    const motherInLayer = new globalThis.Map<number, number>();
    for (const g of layerGroups) {
      if (g.removed) continue;
      liveGroups.set(g.id, g);
      for (const m of g.members) {
        if (m.type === 'spawn') inLayerGroup.set(`${m.kind}:${m.guid}`, g.id);
        else if (m.type === 'group') motherInLayer.set(m.id, g.id);
      }
    }
    const layerGroupIds = new Set(layerGroups.map((g) => g.id));
    const groupOf = (kind: 'npc' | 'object', s: { guid: number; group?: number | null }): number | null => {
      const held = inLayerGroup.get(`${kind}:${s.guid}`);
      const was = s.group ?? null;
      return held ?? (was !== null && layerGroupIds.has(was) ? null : was);
    };
    const grouped = <T extends { guid: number; group?: number | null }>(kind: 'npc' | 'object', s: T): T => {
      const group = groupOf(kind, s);
      return group === (s.group ?? null) && 'group' in s ? s : { ...s, group };
    };
    // The top-level group each database group sits in, as the database's spawns tell it
    const dbTopOf = new globalThis.Map<number, number>();
    for (const { spawns: answer } of [...this.#responses.values(), { spawns: rawSpawns }]) {
      for (const s of [...answer.creatures, ...answer.objects]) if (s.group != null && s.poolTop != null) dbTopOf.set(s.group, s.poolTop);
    }
    // The top-level group a group is in: up through the layer's groups, else the database's; `layer`
    // when the layer decides that group's event, null when it was deleted here
    const topOf = (id: number): { id: number; layer: boolean } | null => {
      const seen = new Set<number>();
      let g = id;
      while (!seen.has(g)) {
        seen.add(g);
        const up = motherInLayer.get(g);
        if (up !== undefined) {
          g = up;
          continue;
        }
        const db = dbTopOf.get(g);
        if (liveGroups.has(g)) return db !== undefined && db !== g && !layerGroupIds.has(db) ? { id: db, layer: false } : { id: g, layer: true };
        if (layerGroupIds.has(g)) return null;
        if (db === undefined || db === g) return { id: g, layer: false };
        if (liveGroups.has(db)) {
          g = db;
          continue;
        }
        return layerGroupIds.has(db) ? null : { id: db, layer: false };
      }
      return { id: g, layer: true };
    };
    // The top-level layer group each spawn is under by that group's full membership, which reaches
    // through database groups the loaded spawns do not name
    // (null under a group deleted here: those spawns are in no group, so lose its database event)
    const underTop = new globalThis.Map<string, number | null>();
    for (const [id, spawns] of this.#groupSpawns) {
      if (layerGroupIds.has(id) && !liveGroups.has(id)) for (const s of spawns) underTop.set(`${s.kind}:${s.guid}`, null);
    }
    for (const [id, spawns] of this.#groupSpawns) {
      if (!liveGroups.has(id) || motherInLayer.has(id)) continue;
      for (const s of spawns) underTop.set(`${s.kind}:${s.guid}`, id);
    }
    // A spawn's events as the layer has its groups: its own event rows, with the event of the top-level
    // group it is in (the layer's, else the database's) in place of the one its database group brought
    const evented = <T extends { guid: number; group?: number | null; event?: ViewEvent | null; events?: ViewEvent[]; removedBy?: ViewEvent[]; poolEvent?: PoolEvent | null }>(kind: 'npc' | 'object', s: T): T => {
      const group = groupOf(kind, s);
      const key = `${kind}:${s.guid}`;
      const walked = inLayerGroup.has(key) ? undefined : underTop.get(key);
      const top = walked === null ? null : walked !== undefined ? { id: walked, layer: true } : group === null ? null : topOf(group);
      const db = s.poolEvent ?? null;
      const dropDb = db !== null && !db.alsoOwn && !(top !== null && !top.layer && top.id === db.pool);
      const set = top?.layer ? liveGroups.get(top.id)!.event : null;
      if (!dropDb && !set) return s;
      const without = (list: ViewEvent[]) => (dropDb ? list.filter((e) => e.id !== db!.id) : list);
      let events = without(s.events ?? (s.event ? [s.event] : []));
      let removedBy = without(s.removedBy ?? []);
      if (set) {
        const e = { id: set.id, name: eventNames.get(set.id) ?? `Event ${set.id}` };
        if (set.during && !events.some((x) => x.id === e.id)) events = [...events, e].sort((a, b) => a.id - b.id);
        if (!set.during && !removedBy.some((x) => x.id === e.id)) removedBy = [...removedBy, e].sort((a, b) => a.id - b.id);
      }
      return { ...s, event: events[0] ?? null, events, removedBy };
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
    // The layer's own events of a database spawn
    const ownEvents = new globalThis.Map((this.#layer.spawnEvents ?? []).map((e) => [e.guid, e.current]));
    const creature = (c: ViewCreature): ViewCreature => {
      const at = placed('creature', c.guid);
      const mine = ownEvents.has(c.guid) ? { ...c, spawnEvents: ownEvents.get(c.guid)! } : c;
      return grouped('npc', routed(timed('creature', at ? { ...mine, x: at.x, y: at.y, z: at.z, orientation: at.orientation } : mine)));
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
        respawnSecs: a.respawnSecs ?? 300, ...(a.events !== undefined ? { spawnEvents: a.events } : {}),
      }),
    );
    const placedObjects = this.#layer.added.filter((a) => a.kind === 'gameobject').map(
      (a): ViewObject => ({
        guid: a.guid, entry: a.entry, name: a.name, map: a.map, x: a.placement.x, y: a.placement.y, z: a.placement.z,
        // Turned about Z by its facing unless it was tilted
        rotation: a.placement.rotation ?? [0, 0, Math.sin(a.placement.orientation / 2), Math.cos(a.placement.orientation / 2)],
        displayId: a.look.displayId, scale: a.look.scale, objectType: a.look.objectType ?? -1, own: false, added: true, event: null, events: [], removedBy: [], group: null,
        respawnSecs: a.respawnSecs ?? 300,
      }),
    );
    return {
      creatures: [
        ...spawns.creatures.filter((c) => !ownCreatures.has(c.guid) && !deleted.has(`creature:${c.guid}`)).map((c) => evented('npc', c)).filter(shown).map(creature),
        ...this.#own.creatures.filter(inBox).map((c) => evented('npc', grouped('npc', c))).filter(shown),
        ...placedCreatures.filter(inBox).map((c) => evented('npc', grouped('npc', routed(c)))).filter(shown),
      ].map(pending),
      objects: [
        ...spawns.objects.filter((o) => !ownObjects.has(o.guid) && !deleted.has(`gameobject:${o.guid}`)).map((o) => evented('object', o)).filter(shown).map(object),
        ...this.#own.objects.filter(inBox).map((o) => evented('object', grouped('object', o))).filter(shown),
        ...placedObjects.filter(inBox).map((o) => evented('object', grouped('object', o))).filter(shown),
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

  /**
   * Every spawn under each top-level layer group with an event (or a cleared one), and each deleted group
   * that had one, through all its levels, by group id: the event walk reaches them through database
   * groups the loaded spawns do not name
   */
  async setGroupSpawns(byGroup: ReadonlyMap<number, readonly { kind: 'npc' | 'object'; guid: number }[]>) {
    this.#groupSpawns = byGroup;
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

  /** A row's place as the view has it: carried by the frame, like everything else the scene hands out */
  #inView(placement: Placement): Placement {
    return isIdentity(this.#frame) ? placement : placementToWorld(this.#frame, placement);
  }

  /** A drawn spawn as the right-click menu describes it (where it stands in the view), or null when it is not drawn */
  info(kind: 'creature' | 'object', guid: number): SpawnInfo | null {
    for (const group of this.#areas.values()) {
      const data: ViewCreature | ViewObject | undefined = (kind === 'creature' ? group.userData.creatures : group.userData.objects)?.get(guid);
      if (!data) continue;
      const base = { kind, guid, entry: data.entry, name: data.name, own: data.own, added: data.added ?? false, map: data.map, group: data.group ?? null, respawnSecs: data.respawnSecs ?? 300 };
      if (kind === 'creature') {
        const c = data as ViewCreature;
        return { ...base, pathId: c.pathId ?? 0, wander: c.wander, placement: this.#inView({ x: c.x, y: c.y, z: c.z, orientation: c.orientation, rotation: null }), spawnEvents: c.spawnEvents === undefined ? 'npc' : c.spawnEvents, eventsNow: { during: c.events, gone: c.removedBy }, ...(c.npcFlags === undefined ? {} : { npcFlags: c.npcFlags }), ...(c.gossipMenuId === undefined ? {} : { gossipMenuId: c.gossipMenuId }) };
      }
      const o = data as ViewObject;
      const objectType = o.objectType ?? -1;
      return { ...base, pathId: 0, wander: 0, placement: this.#inView({ x: o.x, y: o.y, z: o.z, orientation: facingOf(o.rotation), rotation: o.rotation }), ...(objectType >= 0 ? { objectType } : {}) };
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
    // A vessel's walking paths are drawn, but not edited there: none of their points is picked
    if (!isIdentity(this.#frame)) return null;
    let best: { point: number; distance: number } | null = null;
    for (const group of this.#areas.values()) {
      for (const shown of holderOf(group, 'paths')?.children ?? []) {
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
    return this.pickHit(ray, maxDistance)?.spawn ?? null;
  }

  /** `pick`, with how far along the ray the spawn's bounds were hit, for telling which of several views' spawns is nearer */
  pickHit(ray: THREE.Ray, maxDistance = Infinity): { spawn: PickedSpawn; distance: number } | null {
    const hit = new THREE.Vector3();
    const hits: { spawn: THREE.Object3D; distance: number; bounds: THREE.Box3 }[] = [];
    for (const group of this.#areas.values()) {
      for (const name of ['creatures', 'objects'] as const) {
        const kind = holderOf(group, name);
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
    return { spawn: { ...best.spawn.userData.spawn, position: { ...best.spawn.userData.spawn.position } }, distance: best.distance };
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
      const paths = holderOf(group, 'paths');
      // A vessel's route points are not edited there, as `pickRoutePoint` says
      for (const shown of paths?.visible && isIdentity(this.#frame) ? paths.children : []) {
        if (!shown.visible) continue;
        for (const ball of shown.children) {
          if (typeof ball.userData.point === 'number') points.push({ guid: shown.userData.guid, index: ball.userData.point, at: ball.position.clone() });
        }
      }
      for (const name of ['creatures', 'objects'] as const) {
        const kind = holderOf(group, name);
        if (!kind?.visible) continue;
        for (const spawn of kind.children) {
          if (!spawn.visible || !spawn.userData.spawn || !this.#drawn(spawn, name, cameraPosition)) continue;
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
      for (const shown of holderOf(group, 'paths')?.children ?? []) {
        if (shown.userData.guid === guid && shown.name === 'route') {
          shown.userData.previewed = true;
          moveRouteDrawing(shown as THREE.Group, { x: creature.x, y: creature.y, z: creature.z }, points);
        }
      }
    }
  }

  /** Takes an NPC's route (its first leg) and wander circle to where it is being dragged, without drawing its area again */
  previewHome(guid: number, at: { x: number; y: number; z: number }) {
    for (const group of this.#areas.values()) {
      const creature: ViewCreature | undefined = group.userData.creatures?.get(guid);
      if (!creature) continue;
      for (const shown of holderOf(group, 'paths')?.children ?? []) {
        if (shown.userData.guid !== guid) continue;
        // Drawn from the next redraw's data again, whatever it says
        shown.userData.previewed = true;
        if (shown.name === 'route') {
          const points = this.#pendingRoutes.get(guid) ?? creature.path;
          if (points?.length) moveRouteDrawing(shown as THREE.Group, at, points);
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
      const shown = holderOf(group, kind === 'creature' ? 'creatures' : 'objects');
      if (!shown?.visible) continue;
      const spawn = shown.children.find((child) => child.userData.spawn?.guid === guid);
      if (spawn) return (spawn.userData.drawn ?? spawn.visible) ? spawn : null;
    }
    return null;
  }

  /** Draws only the spawns within the draw distance of the camera; a hidden model stops animating */
  cull(cameraPosition: THREE.Vector3, frustum?: THREE.Frustum) {
    this.#focus.copy(cameraPosition);
    this.#focused = true;
    let grounding = GROUNDS_PER_FRAME;
    for (const group of this.#areas.values()) {
      for (const name of ['creatures', 'objects'] as const) {
        for (const spawn of (holderOf(group, name)?.children ?? []) as DrawnModel[]) {
          const near = this.#drawn(spawn, name, cameraPosition);
          // Drawn, as edits and outlines see it; shown only while the camera also looks at it
          spawn.userData.drawn = near;
          if (near && name === 'creatures' && grounding > 0 && this.#ground(spawn)) grounding -= 1;
          const seen = near && (!frustum || inView(spawn, frustum));
          // Walkers look for their ground only while seen
          spawn.userData.seen = seen;
          if (spawn.show && spawn.hide) {
            if (seen) spawn.show();
            else spawn.hide();
          } else {
            spawn.visible = seen;
          }
          if (name === 'creatures') showWorn(spawn, seen && spawn.position.distanceTo(cameraPosition) <= WORN_DETAIL_DISTANCE);
        }
      }
      // Only the active routes and wander circles, however far they have been left behind; picked points marked
      for (const shown of holderOf(group, 'paths')?.children ?? []) {
        shown.visible = this.#activeRoutes.has(shown.userData.guid);
        if (!shown.visible || shown.name !== 'route') continue;
        for (const ball of shown.children) {
          if (typeof ball.userData.point !== 'number') continue;
          const marked = this.#marked.has(`${shown.userData.guid}:${ball.userData.point}`);
          if (marked !== (ball.userData.marked === true)) {
            ball.userData.marked = marked;
            setBallSelected(ball as THREE.Mesh, marked);
          }
        }
      }
    }
  }

  /** Whether a spawn is drawn: within draw distance of the camera, or an NPC whose route is worked on */
  #drawn(spawn: THREE.Object3D, name: string, cameraPosition: THREE.Vector3): boolean {
    if (name === 'creatures' && this.#activeRoutes.has(spawn.userData.spawn?.guid)) return true;
    return spawn.position.distanceTo(cameraPosition) <= SPAWN_DRAW_DISTANCE;
  }

  /**
   * Lifts an NPC that stands below the drawn ground onto it, once the ground is there to be found
   * (a few tries, for terrain still loading). Drawing only: the spawn's own position, which is what
   * the card shows and an edit writes, is not touched (see `userData.lift`). True when it asked.
   */
  #ground(spawn: THREE.Object3D): boolean {
    const data = spawn.userData;
    if (!this.#groundBelow || !isIdentity(this.#frame) || data.grounded || !data.spawn || spawn.name === 'marker') return false;
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
      // Drawn again by its walker: lifted at home, and left where it is when it has walked away
      this.#walkers.refresh(spawn);
    }
    return true;
  }

  /**
   * Walks the NPCs `deltaTime` seconds on (models animate through the shared model manager): one whose
   * route is worked on is held at home; one out of range, or with the NPC layer hidden, is left where
   * it is; one out of view walks without looking for its ground
   */
  update(deltaTime: number, _camera: THREE.Camera) {
    this.#walkers.tick(deltaTime * 1000, this.#activity);
  }

  #activity = (guid: number, drawn: THREE.Object3D): Activity => {
    if (this.#activeRoutes.has(guid)) return 'hold';
    if (!drawn.userData.drawn || !drawn.parent?.visible) return 'skip';
    return drawn.userData.seen ? 'move' : 'unseen';
  };

  /** A group with nothing in it yet: the holders for an area's NPCs, objects and their paths */
  #empty(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'spawns';
    group.matrixAutoUpdate = false;
    for (const name of ['creatures', 'objects', 'paths']) {
      const holder = new THREE.Group();
      holder.name = name;
      // Never moved themselves: only what is in them is worked out each frame
      holder.matrixAutoUpdate = false;
      group.add(holder);
    }
    // Routes are drawn from rows, so on a vessel they are carried by its frame
    framePaths(holderOf(group, 'paths')!, this.#frame);
    group.userData.creatures = new globalThis.Map();
    group.userData.objects = new globalThis.Map();
    return group;
  }

  async #patch(group: THREE.Group, spawns: ViewSpawns) {
    const creatures = holderOf(group, 'creatures')!;
    const objects = holderOf(group, 'objects')!;
    const paths = holderOf(group, 'paths')!;
    const containers = { creature: creatures, object: objects };
    const fill = (group.userData.fill ?? 0) + 1;
    group.userData.fill = fill;

    // Routes and wander circles: drawn again only for NPCs whose route, place or wander changed
    const before: globalThis.Map<number, ViewCreature> = group.userData.creatures ?? new globalThis.Map();
    const now = new globalThis.Map(spawns.creatures.map((c) => [c.guid, c]));
    const changed = new globalThis.Set<number>();
    for (const [guid, creature] of now) if (movesKeyOf(creature) !== (before.has(guid) ? movesKeyOf(before.get(guid)!) : null)) changed.add(guid);
    for (const guid of before.keys()) if (!now.has(guid)) changed.add(guid);
    // Moved while dragging: drawn again from the data, which may not have taken the move
    for (const shown of paths.children) if (shown.userData.previewed) changed.add(shown.userData.guid);

    // Each is added as soon as it is made, unless the group was filled again or taken away meanwhile
    const drawing: Promise<void>[] = [];
    const add = (container: THREE.Object3D, made: THREE.Object3D, old: THREE.Object3D | undefined) => {
      if (group.userData.fill !== fill) {
        this.#remove(made);
        return;
      }
      container.add(made);
      made.updateMatrixWorld(true);
      // Walked before the old drawing goes, so an NPC drawn again walks on from where it was
      if (container === creatures) this.#walkers.track(made, made.userData.row);
      if (old) this.#remove(old);
    };
    // The ones nearest the camera are asked for first, so their models are the first made
    const nearestFirst = <T extends { x: number; y: number; z: number }>(list: T[]): T[] => {
      if (!this.#focused || list.length < 2) return list;
      const { x, y, z } = this.#focus;
      const away = new globalThis.Map(list.map((s) => [s, (s.x - x) ** 2 + (s.y - y) ** 2 + (s.z - z) ** 2]));
      return [...list].sort((a, b) => away.get(a)! - away.get(b)!);
    };
    const sync = (kind: 'creature' | 'object', list: (ViewCreature | ViewObject)[]) => {
      const container = containers[kind];
      const drawn = new globalThis.Map(container.children.map((c) => [c.userData.spawn.guid, c]));
      const wanted = new globalThis.Set<number>();
      for (const spawn of nearestFirst(list)) {
        wanted.add(spawn.guid);
        const transform = this.#transformOf(kind, spawn);
        const old = drawn.get(spawn.guid);
        // Walked again only when its route, place, wander or facing changed (a walking NPC keeps where it is)
        if (old) this.#place(old, kind, spawn, transform, changed.has(spawn.guid) || old.userData.row?.orientation !== (spawn as ViewCreature).orientation);
        if (old && old.userData.lookKey === lookKeyOf(kind, spawn)) continue;
        const resolve = kind === 'creature' ? () => this.#resolver.creature(spawn.displayId, (spawn as ViewCreature).preset ?? null) : () => this.#resolver.object(spawn.displayId);
        drawing.push(this.#drawSpawn(kind, spawn, resolve, transform).then((made) => add(container, made, old)));
      }
      for (const [guid, object] of drawn) {
        if (!wanted.has(guid)) this.#remove(object);
      }
    };
    sync('creature', spawns.creatures);
    sync('object', spawns.objects);

    // Routes and wander circles: drawn again only for NPCs whose route, place or wander changed
    for (const shown of [...paths.children]) if (changed.has(shown.userData.guid)) this.#remove(shown);
    for (const guid of changed) {
      const creature = now.get(guid);
      if (creature) for (const shown of movesOf(creature)) paths.add(shown);
    }
    // The creatures as drawn, so a route can be read back as the view has it, and the objects for the menu
    group.userData.creatures = now;
    group.userData.objects = new globalThis.Map(spawns.objects.map((o) => [o.guid, o]));
    this.#applyVisibility(group);
    group.updateMatrixWorld(true);

    await Promise.all(drawing);
  }

  /**
   * A drawn spawn put where it now stands, and turned; one that moved is stood on the ground again from
   * there. A walking NPC whose walk did not change (`walkChanged`) is left where it has walked to.
   */
  #place(object: THREE.Object3D, kind: 'creature' | 'object', spawn: ViewCreature | ViewObject, transform: Transform, walkChanged: boolean) {
    const data = object.userData;
    const was = data.spawn.position;
    const moved = was.x !== spawn.x || was.y !== spawn.y || was.z !== spawn.z;
    data.spawn = spawnDataOf(kind, spawn);
    data.row = spawn;
    if (moved) {
      data.lift = 0;
      data.grounded = false;
      data.tries = 0;
      data.groundAfter = undefined;
    }
    if (kind === 'creature' && !walkChanged && this.#walkers.has(object)) return;
    object.position.set(transform.position[0], transform.position[1], transform.position[2] + (data.lift ?? 0));
    object.quaternion.set(...transform.quaternion);
    object.updateMatrixWorld(true);
    if (kind === 'creature') this.#walkers.track(object, spawn as ViewCreature);
  }

  /** Takes one drawn thing out of its group and frees what it holds of its own; an NPC stops walking */
  #remove(object: THREE.Object3D) {
    this.#walkers.untrack(object);
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
    const owned: DrawnModel[] = [];
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
    let drawn: DrawnModel | null = null;
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
        const holder = drawn;
        if (look.kind === 'model' && look.attachments?.length && canHold(holder)) {
          await Promise.all(look.attachments.map((worn) => this.#wear(holder, worn)));
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
    const holder = drawn;
    if (kind === 'creature' && canHold(holder)) {
      const [mainHand, offHand] = (spawn as ViewCreature).equipment ?? [0, 0, 0];
      await Promise.all(([[mainHand, 1], [offHand, 2]] as const).map(([item, point]) => this.#hold(holder, item ?? 0, point)));
    }

    const object = drawn ?? this.#marker(kind);
    object.position.set(...transform.position);
    object.quaternion.set(...transform.quaternion);
    object.scale.setScalar(transform.scale * (drawn ? lookScale : 1));
    object.userData.spawn = spawnDataOf(kind, spawn);
    // The row itself, so a new frame can place it again
    object.userData.row = spawn;
    // What it was drawn from: a change to any of it means drawing it again, not just moving it
    object.userData.lookKey = lookKeyOf(kind, spawn);
    // Moved only where the manager and the editor work its matrix out themselves (`updateMatrixWorld(true)`): the
    // scene's every-frame pass skips it, with what it wears and holds, instead of working out thousands of matrices
    object.matrixWorldAutoUpdate = false;
    return object;
  }

  /** A worn model (a helmet, a shoulder pad) at its attachment point; one that cannot be drawn is left off */
  async #wear(model: Holder, worn: { point: number; look: ModelLook }) {
    try {
      const point = model.attachmentObject(worn.point);
      if (point) point.add(await this.#createModel(worn.look));
    } catch (error) {
      this.#warnOnce(`worn:${worn.look.path}`, `3D view: ${worn.look.path} could not be drawn: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** A weapon in one of a model's hands; one that cannot be drawn is left out (the resolver says why) */
  async #hold(model: Holder, itemId: number, point: number) {
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

  /** Shows the kinds asked for; a vessel's walking paths are drawn on it (their holder takes the frame) */
  #applyVisibility(group: THREE.Group) {
    for (const name of ['creatures', 'objects', 'paths'] as const) {
      const child = holderOf(group, name);
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
export { SpawnManager, spawnBounds, spawnLocalBounds };
export type { EventFilter, PickedSpawn, SpawnSource, SpawnStatus, SpawnVisibility };

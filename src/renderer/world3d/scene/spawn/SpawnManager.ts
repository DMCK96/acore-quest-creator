// @ts-nocheck
/**
 * The world's NPCs and objects in the 3D view: one group per loaded area (a 533-yard tile), like the
 * terrain, buildings and liquid. Each spawn is drawn with its display's model (or building), placed by
 * its position, facing and scale; one that cannot be drawn is a marker, logged once to the console.
 * Spawns come from a source (the world database through the app); a source that cannot give them
 * leaves the world drawn without them.
 */
import * as THREE from 'three';
import { ViewCreature, ViewObject, ViewSpawns } from '../../../../core/db/view-spawns.js';
import { DisplayResolver, Look, ModelLook } from './DisplayResolver.js';
import { creatureTransform, objectTransform, Transform } from './placement.js';
import { routeObject, wanderObject } from './paths.js';

type Box = { minX: number; maxX: number; minY: number; maxY: number };

type SpawnSource = (map: number, box: Box) => Promise<ViewSpawns | { error: string }>;

type SpawnVisibility = { creatures: boolean; objects: boolean; paths: boolean };

type SpawnManagerOptions = {
  resolver: DisplayResolver;
  createModel(look: ModelLook): Promise<THREE.Object3D>;
  createBuilding(path: string): Promise<THREE.Object3D>;
  source: SpawnSource | null;
  /** The time in milliseconds (for when to ask again after a failure); Date.now by default */
  now?: () => number;
};

type SpawnStatus = { capped: { creatures: boolean; objects: boolean }; error: string | null };

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

const ALL_VISIBLE: SpawnVisibility = { creatures: true, objects: true, paths: true };

class SpawnManager {
  #resolver: DisplayResolver;
  #createModel: SpawnManagerOptions['createModel'];
  #createBuilding: SpawnManagerOptions['createBuilding'];
  #source: SpawnSource | null;

  #areas = new globalThis.Map<number, THREE.Group>();
  /** Each area's last answer from the source, so the area can be redrawn without asking again */
  #responses = new globalThis.Map<number, { map: number; box: Box; spawns: ViewSpawns }>();
  /** Areas asked for and not removed since; a removal while asking drops the answer */
  #wanted = new globalThis.Map<number, number>();
  #requests = 0;
  #visibility: SpawnVisibility = { ...ALL_VISIBLE };
  #own: ViewSpawns = { creatures: [], objects: [], capped: { creatures: false, objects: false } };
  #warned = new Set<string>();
  #now: () => number;
  /** Areas whose answer failed, and when they may be asked for again */
  #failed = new globalThis.Map<number, number>();

  status: SpawnStatus = { capped: { creatures: false, objects: false }, error: null };

  constructor(options: SpawnManagerOptions) {
    this.#resolver = options.resolver;
    this.#createModel = options.createModel;
    this.#createBuilding = options.createBuilding;
    this.#source = options.source;
    this.#now = options.now ?? Date.now;
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

    const group = await this.#draw(this.#withOwn(answer, box, map));
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
    await Promise.all(
      [...this.#areas.entries()].map(([areaId, group]) => {
        const response = this.#responses.get(areaId);
        return response ? this.#fill(group, this.#withOwn(response.spawns, response.box, response.map)) : null;
      }),
    );
  }

  /** An area's database spawns, less any the open quest has its own of, plus its own in the box on its map */
  #withOwn(spawns: ViewSpawns, box: Box, map: number): ViewSpawns {
    const inBox = (s: { map: number; x: number; y: number }) => s.map === map && s.x >= box.minX && s.x <= box.maxX && s.y >= box.minY && s.y <= box.maxY;
    const ownCreatures = new Set(this.#own.creatures.map((c) => c.guid));
    const ownObjects = new Set(this.#own.objects.map((o) => o.guid));
    return {
      creatures: [...spawns.creatures.filter((c) => !ownCreatures.has(c.guid)), ...this.#own.creatures.filter(inBox)],
      objects: [...spawns.objects.filter((o) => !ownObjects.has(o.guid)), ...this.#own.objects.filter(inBox)],
      capped: spawns.capped,
    };
  }

  setVisibility(visibility: SpawnVisibility) {
    this.#visibility = { ...visibility };
    for (const group of this.#areas.values()) {
      this.#applyVisibility(group);
    }
  }

  /** Draws only the spawns within the draw distance of the camera; a hidden model stops animating */
  cull(cameraPosition: THREE.Vector3) {
    for (const group of this.#areas.values()) {
      for (const name of ['creatures', 'objects']) {
        for (const spawn of group.getObjectByName(name)?.children ?? []) {
          const near = spawn.position.distanceTo(cameraPosition) <= SPAWN_DRAW_DISTANCE;
          if (typeof spawn.show === 'function') {
            if (near) spawn.show();
            else spawn.hide();
          } else {
            spawn.visible = near;
          }
        }
      }
      for (const shown of group.getObjectByName('paths')?.children ?? []) {
        shown.visible = shown.userData.anchor.distanceTo(cameraPosition) <= SPAWN_DRAW_DISTANCE;
      }
    }
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
        this.#drawSpawn('creature', creature, () => this.#resolver.creature(creature.displayId), creatureTransform(creature)),
      ),
    );
    for (const drawn of drawnCreatures) creatures.add(drawn);

    // How they move: patrol routes and wander circles, in world coordinates
    for (const creature of spawns.creatures) {
      // Each remembers whose it is, so it is drawn only while its NPC is near enough to be
      const anchor = new THREE.Vector3(creature.x, creature.y, creature.z);
      for (const shown of [routeObject(creature), wanderObject(creature)]) {
        if (shown) {
          shown.userData.anchor = anchor;
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
      const look = await resolve();
      if (look) {
        lookScale = look.scale;
        drawn = look.kind === 'building' ? await this.#createBuilding(look.path) : await this.#createModel(look);
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
    object.userData.spawn = { kind, guid: spawn.guid, own: spawn.own };
    return object;
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
export { SpawnManager };
export type { SpawnSource, SpawnStatus, SpawnVisibility };

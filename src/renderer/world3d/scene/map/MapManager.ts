// @ts-nocheck
import * as THREE from 'three';
import {
  AreaTableRecord,
  ClientDb,
  Map,
  MAP_AREA_COUNT_Y,
  MAP_CHUNK_COUNT_Y,
  MAP_CHUNK_COUNT_X,
  MAP_CHUNK_HEIGHT,
} from '@wowserhq/format';
import TerrainManager from './terrain/TerrainManager.js';
import TextureManager from '../texture/TextureManager.js';
import DoodadManager from './DoodadManager.js';
import WmoManager from '../wmo/WmoManager.js';
import LiquidManager from './liquid/LiquidManager.js';
import SpawnManager, { SpawnSource, SpawnVisibility } from '../spawn/SpawnManager.js';
import { CharacterTexture } from '../character/CharacterTexture.js';
import { getAssetUrl } from '../asset.js';
import DisplayResolver from '../spawn/DisplayResolver.js';
import { areaBox, nearbyAreas } from '../spawn/placement.js';
import type { Movement } from '../../../../core/world/movement.js';
import { DISPLAY_RECORDS } from '../db/records.js';
import { ViewSpawns } from '../../../../core/db/view-spawns.js';
import type { EntityLooks } from '../../../../core/entities/view-spawns.js';
import { WorldLayer } from '../../../../core/world/layer.js';
import { AssetHost } from '../asset.js';
import MapLoader from './loader/MapLoader.js';
import { GLOBAL_AREA, WHOLE_MAP, globalWmoArea, type GlobalWmo } from './global-wmo.js';
import { MapAreaSpec, MapSpec } from './loader/types.js';
import MapLight from './light/MapLight.js';
import DbManager from '../db/DbManager.js';
import { describeError, reportProblem } from '../diagnostics.js';

const DEFAULT_VIEW_DISTANCE = 1277.0;
const DETAIL_DISTANCE_EXTENSION = MAP_CHUNK_HEIGHT;

/**
 * Works out where everything in a group that never moves is, once, and leaves it out of every later
 * frame's update: tens of thousands of terrain chunks and doodads cost more than drawing them did
 */
function freeze(group: THREE.Object3D) {
  group.matrixAutoUpdate = false;
  group.updateMatrixWorld(true);
  group.matrixWorldAutoUpdate = false;
}

type MapManagerOptions = {
  host: AssetHost;
  textureManager?: TextureManager;
  /** Dressed NPCs' body texture builder, shared with every world that shares the texture manager */
  characterTexture?: CharacterTexture;
  dbManager?: DbManager;
  viewDistance?: number;
  /** The drawn ground nearest below a point, for standing NPCs on it; see `SpawnManager` */
  groundBelow?(x: number, y: number, fromZ: number, distance: number): number | null;
};

class MapManager extends EventTarget {
  #mapName: string;
  #mapDir: string;
  #map: MapSpec;

  #loader: MapLoader;
  #loadingAreas = new globalThis.Map<number, Promise<MapAreaSpec>>();
  #loadedAreas = new globalThis.Map<number, MapAreaSpec>();

  #root: THREE.Group;
  #terrainGroups = new globalThis.Map<number, THREE.Group>();
  #doodadGroups = new globalThis.Map<number, THREE.Group>();
  #wmoGroups = new globalThis.Map<number, THREE.Group>();
  #liquidGroups = new globalThis.Map<number, THREE.Group>();
  #spawnGroups = new globalThis.Map<number, THREE.Group>();
  /** Whether buildings (with what is inside them) and doodads (trees, fences, carts) are drawn */
  #scenery = { buildings: true, doodads: true };
  /** Areas whose spawns were asked for and not dropped since (drawn, on their way, or failed) */
  #spawnAsked = new Set<number>();
  #mapId: number;

  #textureManager: TextureManager;
  #terrainManager: TerrainManager;
  #doodadManager: DoodadManager;
  #wmoManager: WmoManager;
  #liquidManager: LiquidManager;
  #spawnManager: SpawnManager;
  #dbManager: DbManager;

  #mapLight: MapLight;

  #areaTableDb: ClientDb<AreaTableRecord>;

  #target = new THREE.Vector2();
  #targetAreaX: number;
  #targetAreaY: number;
  #targetChunkX: number;
  #targetChunkY: number;
  #targetArea: MapAreaSpec;
  #targetAreaTableId: number;

  #viewDistance = DEFAULT_VIEW_DISTANCE;
  #detailDistance = this.#viewDistance;

  #cullingProjection = new THREE.Matrix4();
  #cullingFrustum = new THREE.Frustum();

  #desiredAreas = new Set<number>();

  // Areas that failed to load: left out, and not asked for again every frame
  #failedAreas = new Set<number>();


  constructor(options: MapManagerOptions) {
    super();

    if (options.viewDistance) {
      this.#viewDistance = options.viewDistance;
      this.#detailDistance = this.#viewDistance;
    }

    this.#textureManager = options.textureManager ?? new TextureManager({ host: options.host });
    this.#dbManager = options.dbManager ?? new DbManager({ host: options.host });

    this.#loader = new MapLoader({ host: options.host });

    this.#mapLight = new MapLight({ dbManager: this.#dbManager });

    this.#terrainManager = new TerrainManager({
      host: options.host,
      textureManager: this.#textureManager,
      mapLight: this.#mapLight,
    });
    this.#doodadManager = new DoodadManager({
      host: options.host,
      textureManager: this.#textureManager,
      mapLight: this.#mapLight,
    });
    this.#liquidManager = new LiquidManager({
      textureManager: this.#textureManager,
      dbManager: this.#dbManager,
      mapLight: this.#mapLight,
    });
    this.#wmoManager = new WmoManager({
      host: options.host,
      textureManager: this.#textureManager,
      mapLight: this.#mapLight,
      liquidManager: this.#liquidManager,
    });
    // The world's NPCs and objects, drawn with the doodads' models and the buildings' manager; their
    // looks come from the client's display tables. Spawns arrive once the app gives a source
    const resolver = new DisplayResolver({
      get: (name) => this.#dbManager.get(`${name}.dbc`, DISPLAY_RECORDS[name]),
    });
    // Dressed NPCs' body textures, built from the client's own files and given to the texture manager
    const characterTexture = options.characterTexture ?? new CharacterTexture({
      read: async (path) => {
        const response = await fetch(getAssetUrl(options.host, path));
        return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
      },
      register: (path, texture) => this.#textureManager.register(path, texture),
    });
    this.#spawnManager = new SpawnManager({
      resolver,
      createModel: (look) => this.#doodadManager.modelManager.get(look.path, look),
      createBuilding: (path) => this.#wmoManager.createInstance(path),
      source: null,
      bodyTexture: (body) => characterTexture.build(body),
      groundBelow: options.groundBelow,
    });

    // Never moved, so never worked out again; what is under it is still visited (spawns move). The
    // scene must not force it either (see world3d.ts), or every frame works out every object's matrix.
    this.#root = new THREE.Group();
    this.#root.matrixAutoUpdate = false;
    this.#root.add(this.#doodadManager.batches);
  }

  get clearColor() {
    return this.#mapLight.fogColor;
  }

  get cameraFar() {
    return this.#detailDistance;
  }

  get mapMame() {
    return this.#mapName;
  }

  /** Where the NPCs and objects come from; null draws none */
  setSpawnSource(source: SpawnSource | null) {
    this.#spawnManager.setSource(source);
  }

  /** The looks of edited existing NPCs and objects, drawn on their database spawns */
  setLooks(looks: EntityLooks) {
    this.#spawnManager.setLooks(looks).catch((error) => console.warn(`3D view: edited looks could not be drawn: ${describeError(error)}`));
  }

  /** The open quest's own NPCs and objects, drawn with the world's */
  setOwnSpawns(spawns: ViewSpawns) {
    this.#spawnManager.setOwnSpawns(spawns).catch((error) => console.warn(`3D view: the quest's own NPCs and objects could not be drawn: ${describeError(error)}`));
  }

  /** Shows or hides buildings and doodads; a hidden kind is not drawn and not hit by a click */
  setScenery(scenery: { buildings: boolean; doodads: boolean }) {
    this.#scenery = { ...scenery };
    this.#doodadManager.setInteriors(scenery.buildings);
  }

  setSpawnVisibility(visibility: SpawnVisibility) {
    this.#spawnManager.setVisibility(visibility).catch((error) => console.warn(`3D view: the NPCs and objects could not be redrawn: ${describeError(error)}`));
  }

  /** The nearest drawn NPC or object along a ray, no further than `maxDistance` */
  pickSpawn(ray: THREE.Ray, maxDistance?: number) {
    return this.#spawnManager.pick(ray, maxDistance);
  }

  /** Draws the world layer's edits over the database's spawns and routes */
  setWorldLayer(layer: WorldLayer) {
    this.#spawnManager.setWorldLayer(layer).catch((error) => console.warn(`3D view: the world changes could not be drawn: ${describeError(error)}`));
  }

  /** Every spawn under each top-level layer group with an event, through all its levels, by group id */
  setGroupSpawns(byGroup: ReadonlyMap<number, readonly { kind: 'npc' | 'object'; guid: number }[]>) {
    this.#spawnManager.setGroupSpawns(byGroup).catch((error) => console.warn(`3D view: the spawn groups' events could not be drawn: ${describeError(error)}`));
  }

  /** Which of an NPC's route points a ray passes close to, or null */
  pickRoutePoint(ray: THREE.Ray, guid: number) {
    return this.#spawnManager.pickRoutePoint(ray, guid);
  }

  /** Draws a route edited in the view until its host stores it */
  setPendingRoute(guid: number, points: { x: number; y: number; z: number; carry?: unknown }[]) {
    this.#spawnManager.setPendingRoute(guid, points).catch((error) => console.warn(`3D view: the route could not be drawn: ${describeError(error)}`));
  }

  /** A drawn NPC's route as the view has it, or null */
  spawnRoute(guid: number) {
    return this.#spawnManager.route(guid);
  }

  /** Draws an NPC's movement as edited in the view until its host stores it; null draws it as stored */
  setPendingMovement(guid: number, movement: Movement | null) {
    this.#spawnManager.setPendingMovement(guid, movement).catch((error) => console.warn(`3D view: the movement could not be drawn: ${describeError(error)}`));
  }

  /** How a drawn NPC moves, as the view has it, or null */
  movement(guid: number): Movement | null {
    return this.#spawnManager.movement(guid);
  }

  /** The NPCs whose routes are worked on: only their routes and wander circles are drawn */
  setActiveRoutes(guids: number[]) {
    this.#spawnManager.setActiveRoutes(guids);
  }

  /** The picked route points, marked on their routes */
  markRoutePoints(points: { guid: number; index: number }[]) {
    this.#spawnManager.markPoints(points);
  }

  /** What a selection box can catch: drawn route points, and spawns within draw distance */
  selectionCandidates(cameraPosition: THREE.Vector3) {
    return this.#spawnManager.candidates(cameraPosition);
  }

  /** Moves an NPC's drawn route to points being dragged */
  previewRoute(guid: number, points: { x: number; y: number; z: number; carry?: unknown }[]) {
    this.#spawnManager.previewRoute(guid, points);
  }

  /** Takes an NPC's route and wander circle to where it is being dragged */
  previewHome(guid: number, at: { x: number; y: number; z: number }) {
    this.#spawnManager.previewHome(guid, at);
  }

  /** A drawn spawn as a click would pick it, or null */
  pickedSpawn(kind: 'creature' | 'object', guid: number) {
    return this.#spawnManager.picked(kind, guid);
  }

  /** A drawn spawn as the right-click menu describes it, or null */
  spawnInfo(kind: 'creature' | 'object', guid: number) {
    return this.#spawnManager.info(kind, guid);
  }

  /** A spawn's drawn object, while it is drawn */
  findSpawn(kind: 'creature' | 'object', guid: number) {
    return this.#spawnManager.find(kind, guid);
  }

  /** Whether the spawn source capped a kind, or why it could give none */
  get spawnStatus() {
    return { ...this.#spawnManager.status, loading: this.#spawnManager.loading };
  }

  get root() {
    return this.#root;
  }

  /** The one building of a map without terrain tiles: drawn in place of them, with every spawn in one area */
  #globalWmo: GlobalWmo | null = null;

  load(mapName: string, mapId?: number, globalWmo: GlobalWmo | null = null) {
    this.#globalWmo = globalWmo;
    this.#mapName = mapName;
    this.#mapDir = `world/maps/${mapName}`;

    this.#mapLight.mapId = mapId;
    this.#mapId = mapId ?? 0;

    this.#root.name = `map:${mapName}`;

    this.#loadDbs().catch((error) => console.error(error));
    this.#loadMap().catch((error) => console.error(error));
    this.#syncAreas().catch((error) => console.error(error));

    return this;
  }

  setTarget(x: number, y: number) {
    this.#target.set(x, y);

    const previousAreaX = this.#targetAreaX;
    const previousAreaY = this.#targetAreaY;
    const previousChunkX = this.#targetChunkX;
    const previousChunkY = this.#targetChunkY;
    const previousAreaTableId = this.#targetAreaTableId;

    const { areaX, areaY, chunkX, chunkY } = Map.getIndicesFromPosition(x, y);
    this.#targetAreaX = areaX;
    this.#targetAreaY = areaY;
    this.#targetChunkX = chunkX;
    this.#targetChunkY = chunkY;

    const targetArea = this.#loadedAreas.get(this.#getAreaId(areaX, areaY));
    if (targetArea) {
      this.#targetArea = targetArea;

      const localChunkX = chunkX % MAP_CHUNK_COUNT_X;
      const localChunkY = chunkY % MAP_CHUNK_COUNT_Y;
      const localChunkIndex = localChunkX * MAP_CHUNK_COUNT_Y + localChunkY;
      const targetAreaTableId = targetArea.areaTableIds[localChunkIndex];

      if (targetAreaTableId) {
        this.#targetAreaTableId = targetAreaTableId;
      }
    }

    if (previousChunkX !== chunkX || previousChunkY !== chunkY) {
      this.#calculateDesiredAreas();
    }

    if (previousAreaTableId !== this.#targetAreaTableId) {
      this.#handleAreaTableChange();
    }
  }

  update(deltaTime: number, camera: THREE.Camera) {
    this.#mapLight.update(camera);

    // If fog end is closer than the configured view distance, use the fog end plus extension to
    // cull non-visible map elements
    this.#detailDistance = Math.min(
      this.#mapLight.fogEnd + DETAIL_DISTANCE_EXTENSION,
      this.#viewDistance,
    );

    // Obtain camera frustum for use in culling groups
    this.#cullingProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.#cullingFrustum.setFromProjectionMatrix(this.#cullingProjection);

    // Cull entire groups to save on frustum intersection cost
    this.#cullGroups();

    this.#doodadManager.batches.visible = this.#scenery.doodads;
    if (this.#scenery.doodads) {
      this.#doodadManager.cull(this.#cullingFrustum, camera.position);
    } else {
      // Hidden doodads: not culled, and not animated (a hidden model is skipped by the update below)
      this.#doodadManager.hideAll();
      for (const doodadGroup of this.#doodadGroups.values()) doodadGroup.visible = false;
    }
    // Always: the doodads' model manager animates and poses the spawns too, which stay shown
    this.#doodadManager.update(deltaTime, camera);
    for (const wmoGroup of this.#wmoGroups.values()) wmoGroup.visible = this.#scenery.buildings;

    this.#liquidManager.update(deltaTime);

    this.#syncSpawns();
    this.#spawnManager.cull(camera.position, this.#cullingFrustum);
  }

  /**
   * Spawns only for the areas round the camera's target (the terrain streams much further): loaded for
   * areas that came near, dropped for those left behind. Each comes on its own and never holds up the
   * area it is in.
   */
  #syncSpawns() {
    // A one-building map has its one area, with every spawn of the map
    const wanted = this.#globalWmo ? new Set([`${GLOBAL_AREA.areaX}:${GLOBAL_AREA.areaY}`]) : nearbyAreas(this.#targetAreaX, this.#targetAreaY);
    const keyOf = (areaId: number) => {
      const { areaX, areaY } = this.#getAreaIndex(areaId);
      return `${areaX}:${areaY}`;
    };

    // Left behind: dropped and freed, and any answer still on its way for it ignored
    for (const areaId of this.#spawnAsked) {
      if (!wanted.has(keyOf(areaId)) || !this.#terrainGroups.has(areaId)) {
        const group = this.#spawnGroups.get(areaId);
        if (group) this.#root.remove(group);
        this.#spawnGroups.delete(areaId);
        this.#spawnAsked.delete(areaId);
        this.#spawnManager.removeArea(areaId);
      }
    }

    // Came near: asked for, unless already drawn, on its way, or recently failed (the spawn manager knows)
    for (const areaId of this.#terrainGroups.keys()) {
      if (!wanted.has(keyOf(areaId)) || !this.#spawnManager.canLoad(areaId)) {
        continue;
      }
      const { areaX, areaY } = this.#getAreaIndex(areaId);
      this.#spawnAsked.add(areaId);
      this.#spawnManager
        .loadArea(areaId, this.#mapId, this.#globalWmo ? WHOLE_MAP : areaBox(areaX, areaY))
        .then((group) => {
          // Null when it failed or was dropped meanwhile; a stale answer never replaces a newer one
          if (group && this.#spawnAsked.has(areaId) && this.#terrainGroups.has(areaId)) {
            this.#spawnGroups.set(areaId, group);
            this.#root.add(group);
          }
        })
        .catch((error) => console.warn(`3D view: the NPCs and objects of area ${areaId} could not be drawn: ${describeError(error)}`));
    }
  }

  /** Stops every worker this map started; managers it was handed (textures, tables) are left to their owner */
  dispose() {
    this.#liquidManager.dispose();
    this.#wmoManager.dispose();
    this.#doodadManager.dispose();
    this.#loader.dispose();
  }

  #cullGroups() {
    // Terrain groups
    for (const terrainGroup of this.#terrainGroups.values()) {
      terrainGroup.visible = this.#cullingFrustum.intersectsSphere(
        terrainGroup.userData.boundingSphere,
      );
    }
  }

  #handleAreaTableChange() {
    if (!this.#areaTableDb || !this.#targetAreaTableId) {
      return;
    }

    const areaTableRecord = this.#areaTableDb.getRecord(this.#targetAreaTableId);
    if (!areaTableRecord) {
      return;
    }

    const parentAreaTableRecord = this.#areaTableDb.getRecord(areaTableRecord.parentAreaId);

    // Event

    const detail = {
      areaName: areaTableRecord.areaName,
      areaId: areaTableRecord.id,
      parentAreaName: parentAreaTableRecord?.areaName,
      parentAreaId: parentAreaTableRecord?.id,
    };

    this.dispatchEvent(new CustomEvent('area:change', { detail }));
  }

  async #syncAreas() {
    if (!this.#map) {
      requestAnimationFrame(() => this.#syncAreas().catch((error) => console.error(error)));
      return;
    }

    // However one pass goes, the next still happens: a failure must not end the streaming for good
    try {
      await this.#syncAreasOnce();
    } catch (error) {
      console.error(error);
    }

    requestAnimationFrame(() => this.#syncAreas().catch((error) => console.error(error)));
  }

  async #syncAreasOnce() {
    const abandonAreaIds = [];

    for (const areaId of this.#loadedAreas.keys()) {
      if (!this.#desiredAreas.has(areaId)) {
        abandonAreaIds.push(areaId);
      }
    }

    for (const areaId of abandonAreaIds) {
      const terrainGroup = this.#terrainGroups.get(areaId);
      if (terrainGroup) {
        this.#root.remove(terrainGroup);
        this.#terrainGroups.delete(areaId);
        this.#terrainManager.removeArea(areaId);
      }

      const wmoGroup = this.#wmoGroups.get(areaId);
      if (wmoGroup) {
        this.#root.remove(wmoGroup);
        this.#wmoGroups.delete(areaId);
        this.#wmoManager.removeArea(areaId);
      }

      const doodadGroup = this.#doodadGroups.get(areaId);
      if (doodadGroup) {
        this.#root.remove(doodadGroup);
        this.#doodadGroups.delete(areaId);
        this.#doodadManager.removeArea(areaId);
      }

      const spawnGroup = this.#spawnGroups.get(areaId);
      if (spawnGroup) {
        this.#root.remove(spawnGroup);
        this.#spawnGroups.delete(areaId);
      }
      this.#spawnManager.removeArea(areaId);
      this.#spawnAsked.delete(areaId);

      const liquidGroup = this.#liquidGroups.get(areaId);
      if (liquidGroup) {
        this.#root.remove(liquidGroup);
        this.#liquidGroups.delete(areaId);
        this.#liquidManager.removeArea(areaId);
      }

      this.#loadedAreas.delete(areaId);
    }

    const newAreaIds = [];

    for (const areaId of this.#desiredAreas.values()) {
      // Already loaded or loading
      if (
        this.#loadingAreas.has(areaId) ||
        this.#loadedAreas.has(areaId) ||
        this.#failedAreas.has(areaId)
      ) {
        continue;
      }

      if (this.#map.availableAreas[areaId] === 1 || (this.#globalWmo && areaId === this.#getAreaId(GLOBAL_AREA.areaX, GLOBAL_AREA.areaY))) {
        newAreaIds.push(areaId);
      }
    }

    // Each area on its own: one that cannot be loaded is left out, and the rest still draw
    const newAreas = await Promise.allSettled(newAreaIds.map((areaId) => this.#getArea(areaId)));

    for (let i = 0; i < newAreaIds.length; i++) {
      const areaId = newAreaIds[i];
      const newAreaResult = newAreas[i];

      if (newAreaResult.status === 'rejected') {
        this.#failArea(areaId, newAreaResult.reason);
        continue;
      }

      const newArea = newAreaResult.value;

      if (!this.#desiredAreas.has(areaId)) {
        this.#loadedAreas.delete(areaId);
        continue;
      }

      let terrainGroup: THREE.Group;
      let doodadGroup: THREE.Group;
      let wmoGroup: THREE.Group;
      let liquidGroup: THREE.Group;
      try {
        [terrainGroup, [wmoGroup, doodadGroup], liquidGroup] = await Promise.all([
          this.#terrainManager.getArea(areaId, newArea),
          // Buildings first: the doodads include the furniture and props inside them
          this.#wmoManager.getArea(areaId, newArea).then(async (buildings) => {
            const doodadDefs = [...newArea.doodadDefs, ...this.#wmoManager.doodadsOf(areaId)];
            return [buildings, await this.#doodadManager.getArea(areaId, { ...newArea, doodadDefs })] as const;
          }),
          // Liquid that cannot be drawn must not cost the area its terrain
          this.#liquidManager.getArea(areaId, newArea).catch((error) => {
            console.warn(`3D view: the liquid of area ${areaId} could not be drawn: ${describeError(error)}`);
            return new THREE.Group();
          }),
        ]);
      } catch (error) {
        this.#failArea(areaId, error);
        continue;
      }

      const terrainBoundingSphere = new THREE.Box3()
        .setFromObject(terrainGroup)
        .getBoundingSphere(new THREE.Sphere());
      terrainGroup.userData.boundingSphere = terrainBoundingSphere;

      // Terrain, doodads, buildings and liquid never move once placed (doodads animate by their bones)
      for (const group of [terrainGroup, doodadGroup, wmoGroup, liquidGroup]) freeze(group);

      this.#terrainGroups.set(areaId, terrainGroup);
      this.#root.add(terrainGroup);

      this.#doodadGroups.set(areaId, doodadGroup);
      this.#root.add(doodadGroup);

      this.#wmoGroups.set(areaId, wmoGroup);
      this.#root.add(wmoGroup);

      this.#liquidGroups.set(areaId, liquidGroup);
      this.#root.add(liquidGroup);
    }
  }

  #failArea(areaId: number, error: unknown) {
    const { areaX, areaY } = this.#getAreaIndex(areaId);

    this.#failedAreas.add(areaId);
    this.#loadingAreas.delete(areaId);
    this.#loadedAreas.delete(areaId);

    reportProblem(
      `area:${areaId}`,
      `terrain tile ${this.#mapName}_${areaY}_${areaX} could not be loaded: ${describeError(error)}`,
    );
  }

  #getChunkRadius() {
    return this.#viewDistance / MAP_CHUNK_HEIGHT;
  }

  #getAreaId(areaX: number, areaY: number) {
    return areaX * MAP_AREA_COUNT_Y + areaY;
  }

  #getAreaIndex(areaId: number) {
    const areaX = (areaId / MAP_AREA_COUNT_Y) | 0;
    const areaY = areaId % MAP_AREA_COUNT_Y;

    return { areaX, areaY };
  }

  #calculateDesiredAreas() {
    const chunkRadius = this.#getChunkRadius();
    const desiredAreas = new Set<number>();

    for (
      let chunkX = this.#targetChunkX - chunkRadius;
      chunkX <= this.#targetChunkX + chunkRadius;
      chunkX++
    ) {
      for (
        let chunkY = this.#targetChunkY - chunkRadius;
        chunkY <= this.#targetChunkY + chunkRadius;
        chunkY++
      ) {
        const areaX = (chunkX / 16) | 0;
        const areaY = (chunkY / 16) | 0;
        const areaId = this.#getAreaId(areaX, areaY);

        desiredAreas.add(areaId);
      }
    }

    // The building is always wanted: its spawns lie anywhere around it
    if (this.#globalWmo) desiredAreas.add(this.#getAreaId(GLOBAL_AREA.areaX, GLOBAL_AREA.areaY));

    this.#desiredAreas = desiredAreas;
  }

  async #loadDbs() {
    this.#areaTableDb = await this.#dbManager.get('AreaTable.dbc', AreaTableRecord);
  }

  async #loadMap() {
    const mapPath = `${this.#mapDir}/${this.#mapName}.wdt`;
    this.#map = await this.#loader.loadMapSpec(mapPath);
  }

  #getArea(areaId: number) {
    const loaded = this.#loadedAreas.get(areaId);
    if (loaded) {
      return Promise.resolve(loaded);
    }

    const alreadyLoading = this.#loadingAreas.get(areaId);
    if (alreadyLoading) {
      return alreadyLoading;
    }

    const loading = this.#loadArea(areaId);
    this.#loadingAreas.set(areaId, loading);

    return loading;
  }

  async #loadArea(areaId: number) {
    const { areaX, areaY } = this.#getAreaIndex(areaId);
    if (this.#globalWmo) {
      const spec = globalWmoArea(this.#globalWmo);
      this.#loadedAreas.set(areaId, spec);
      this.#loadingAreas.delete(areaId);
      return spec;
    }

    const mapPath = `${this.#mapDir}/${this.#mapName}.wdt`;
    const areaPath = `${this.#mapDir}/${this.#mapName}_${areaY}_${areaX}.adt`;
    const areaSpec = await this.#loader.loadAreaSpec(mapPath, areaPath);

    this.#loadedAreas.set(areaId, areaSpec);
    this.#loadingAreas.delete(areaId);

    return areaSpec;
  }
}

export default MapManager;
export { MapManager };

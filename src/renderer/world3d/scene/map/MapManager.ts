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
import DisplayResolver from '../spawn/DisplayResolver.js';
import { areaBox } from '../spawn/placement.js';
import { DISPLAY_RECORDS } from '../db/records.js';
import { AssetHost } from '../asset.js';
import MapLoader from './loader/MapLoader.js';
import { MapAreaSpec, MapSpec } from './loader/types.js';
import MapLight from './light/MapLight.js';
import DbManager from '../db/DbManager.js';
import SoundManager from '../sound/SoundManager.js';
import { describeError, reportProblem } from '../diagnostics.js';

const DEFAULT_VIEW_DISTANCE = 1277.0;
const DETAIL_DISTANCE_EXTENSION = MAP_CHUNK_HEIGHT;

type MapManagerOptions = {
  host: AssetHost;
  textureManager?: TextureManager;
  dbManager?: DbManager;
  soundManager?: SoundManager;
  viewDistance?: number;
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
  #mapId: number;

  #textureManager: TextureManager;
  #terrainManager: TerrainManager;
  #doodadManager: DoodadManager;
  #wmoManager: WmoManager;
  #liquidManager: LiquidManager;
  #spawnManager: SpawnManager;
  #dbManager: DbManager;
  #soundManager: SoundManager;

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

  #ownedManagers = new Set<any>();

  constructor(options: MapManagerOptions) {
    super();

    if (options.viewDistance) {
      this.#viewDistance = options.viewDistance;
      this.#detailDistance = this.#viewDistance;
    }

    this.#textureManager = options.textureManager ?? new TextureManager({ host: options.host });
    this.#dbManager = options.dbManager ?? new DbManager({ host: options.host });

    if (options.soundManager) {
      this.#soundManager = options.soundManager;
    } else {
      this.#soundManager = new SoundManager({ host: options.host, dbManager: this.#dbManager });
      this.#ownedManagers.add(this.#soundManager);
    }

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
    this.#spawnManager = new SpawnManager({
      resolver,
      createModel: (look) => this.#doodadManager.modelManager.get(look.path, look),
      createBuilding: (path) => this.#wmoManager.createInstance(path),
      source: null,
    });

    this.#root = new THREE.Group();
    this.#root.matrixAutoUpdate = false;
    this.#root.matrixWorldAutoUpdate = false;
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

  setSpawnVisibility(visibility: SpawnVisibility) {
    this.#spawnManager.setVisibility(visibility);
  }

  /** Whether the spawn source capped a kind, or why it could give none */
  get spawnStatus() {
    return this.#spawnManager.status;
  }

  get root() {
    return this.#root;
  }

  load(mapName: string, mapId?: number) {
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

    this.#doodadManager.cull(this.#cullingFrustum, camera.position);
    this.#doodadManager.update(deltaTime, camera);

    this.#liquidManager.update(deltaTime);
  }

  dispose() {
    for (const manager of this.#ownedManagers.values()) {
      manager.dispose();
    }

    this.#liquidManager.dispose();
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

    // Sound

    const useParentZoneMusic =
      areaTableRecord.zoneMusic === 0 &&
      (areaTableRecord.flags & 0x40000000) !== 0 &&
      !!parentAreaTableRecord;

    const zoneMusic = useParentZoneMusic
      ? parentAreaTableRecord.zoneMusic
      : areaTableRecord.zoneMusic;

    this.#soundManager.setZoneMusic(zoneMusic);

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

      if (this.#map.availableAreas[areaId] === 1) {
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
        [terrainGroup, doodadGroup, wmoGroup, liquidGroup] = await Promise.all([
          this.#terrainManager.getArea(areaId, newArea),
          this.#doodadManager.getArea(areaId, newArea),
          this.#wmoManager.getArea(areaId, newArea),
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

      this.#terrainGroups.set(areaId, terrainGroup);
      this.#root.add(terrainGroup);

      this.#doodadGroups.set(areaId, doodadGroup);
      this.#root.add(doodadGroup);

      this.#wmoGroups.set(areaId, wmoGroup);
      this.#root.add(wmoGroup);

      this.#liquidGroups.set(areaId, liquidGroup);
      this.#root.add(liquidGroup);

      // Spawns on their own: they come from the database, may be slow, and must never hold up the area
      const { areaX, areaY } = this.#getAreaIndex(areaId);
      this.#spawnManager
        .loadArea(areaId, this.#mapId, areaBox(areaX, areaY))
        .then((spawnGroup) => {
          if (spawnGroup && this.#loadedAreas.has(areaId)) {
            this.#spawnGroups.set(areaId, spawnGroup);
            this.#root.add(spawnGroup);
          }
        })
        .catch((error) => console.warn(`3D view: the NPCs and objects of area ${areaId} could not be drawn: ${describeError(error)}`));
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

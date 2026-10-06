// @ts-nocheck
import * as THREE from 'three';
import ModelManager from '../model/ModelManager.js';
import TextureManager from '../texture/TextureManager.js';
import { AssetHost } from '../asset.js';
import { MapAreaSpec, MapDoodadDefSpec } from './loader/types.js';
import MapLight from './light/MapLight.js';
import Model from '../model/Model.js';
import { getFade } from '../world.js';
import { describeError, reportProblem } from '../diagnostics.js';
import { ViewChange } from '../view-change.js';
import DoodadBatch from './DoodadBatch.js';

type DoodadManagerOptions = {
  host: AssetHost;
  textureManager?: TextureManager;
  mapLight: MapLight;
};

class DoodadManager {
  #host: AssetHost;
  #modelManager: ModelManager;

  #loadingAreas = new Map<number, Promise<THREE.Group>>();
  #loadedAreas = new Map<number, THREE.Group>();
  #areaBounds = new Map<number, THREE.Sphere>();

  /** By placement id; a building's own doodads by its building's id and their index */
  #doodads = new Map<number | string, Model>();
  #doodadDefs = new Map<number, MapDoodadDefSpec[]>();
  #doodadRefs = new Map<number | string, number>();

  /** Whether the furniture and props inside buildings show: they hide with the buildings */
  #interiors = true;

  /** A cull decides by the camera alone: while it stands still and no area came or went, it is skipped */
  #view = new ViewChange();

  /**
   * Each doodad model's batch, by its path: null while its template loads, or when it cannot be had.
   * The batches live in one group the map adds; see `DoodadBatch`.
   */
  #batches = new Map<string, DoodadBatch | null>();
  #batchGroup = new THREE.Group();

  constructor(options: DoodadManagerOptions) {
    this.#host = options.host;

    this.#modelManager = new ModelManager({
      host: options.host,
      textureManager: options.textureManager,
      sceneLight: options.mapLight,
    });

    this.#batchGroup.name = 'doodads';
    this.#batchGroup.matrixAutoUpdate = false;
  }

  /** The batched doodads, for the map to add to the scene and show or hide with the rest of them */
  get batches(): THREE.Group {
    return this.#batchGroup;
  }

  cull(cullingFrustum: THREE.Frustum, cameraPosition: THREE.Vector3) {
    if (!this.#view.check(cameraPosition, cullingFrustum)) {
      return;
    }

    for (const batch of this.#batches.values()) batch?.begin();

    for (const [areaId, areaGroup] of this.#loadedAreas.entries()) {
      const areaBounds = this.#areaBounds.get(areaId);
      const areaVisible = cullingFrustum.intersectsSphere(areaBounds);

      areaGroup.visible = areaVisible;
      areaGroup.userData.allHidden = false;

      for (const doodad of areaGroup.children as Model[]) {
        if (!areaVisible || (doodad.userData.inside && !this.#interiors)) {
          doodad.hide();
          continue;
        }

        const distance = cameraPosition.distanceTo(doodad.position);
        const fade = getFade(distance, doodad.sizeCategory);

        if (fade === 0.0) {
          doodad.hide();
          continue;
        }

        const doodadVisible = cullingFrustum.intersectsSphere(doodad.boundingSphereWorld);

        if (!doodadVisible) {
          doodad.hide();
          continue;
        }

        // Drawn fully: with the other copies of its model in one call, once that batch is there
        const batch = fade === 1.0 ? this.#batchFor(doodad) : null;
        if (batch) {
          batch.addCopy(doodad);
          doodad.hide();
          continue;
        }

        doodad.alpha = fade;
        doodad.show();
      }
    }

    for (const batch of this.#batches.values()) batch?.finish();
  }

  /** The batch a doodad is drawn in, or null when it cannot be batched or its batch is still coming */
  #batchFor(doodad: Model): DoodadBatch | null {
    if (doodad.userData.batchable === undefined) {
      doodad.userData.batchable = DoodadBatch.fits(doodad);
    }
    if (!doodad.userData.batchable) {
      return null;
    }

    const path: string = doodad.userData.path;
    const key = path.toLowerCase();
    const batch = this.#batches.get(key);
    if (batch !== undefined) {
      return batch;
    }

    // Its own copy of the model, never in the scene, lends the batch its materials and animation
    this.#batches.set(key, null);
    this.#modelManager
      .get(path)
      .then((template) => {
        const made = new DoodadBatch(template);
        this.#batches.set(key, made);
        this.#batchGroup.add(made);
        // The next cull puts the copies in, camera moved or not
        this.#view.mark();
      })
      .catch((error) => {
        console.warn(`3D view: doodad ${path} is drawn copy by copy: ${describeError(error)}`);
      });
    return null;
  }

  /** Shows or hides the furniture and props inside buildings, which go with the buildings */
  setInteriors(show: boolean) {
    if (show === this.#interiors) return;
    this.#interiors = show;
    // A cull decides, whether the camera moved or not
    this.#view.mark();
  }

  /** Hides every doodad, which stops its animation until a cull shows it again; an area once */
  hideAll() {
    for (const areaGroup of this.#loadedAreas.values()) {
      if (areaGroup.userData.allHidden) continue;
      for (const doodad of areaGroup.children as Model[]) doodad.hide();
      areaGroup.userData.allHidden = true;
      // Shown again, they need a cull whether the camera moved or not
      this.#view.mark();
    }
  }

  getArea(areaId: number, area: MapAreaSpec): Promise<THREE.Group> {
    const loaded = this.#loadedAreas.get(areaId);
    if (loaded) {
      return Promise.resolve(loaded);
    }

    const alreadyLoading = this.#loadingAreas.get(areaId);
    if (alreadyLoading) {
      return alreadyLoading;
    }

    const loading = this.#loadArea(areaId, area);
    this.#loadingAreas.set(areaId, loading);

    return loading;
  }

  removeArea(areaId: number) {
    this.#view.mark();
    this.#areaBounds.delete(areaId);
    this.#loadedAreas.delete(areaId);

    // Dereference doodads
    for (const doodadDef of this.#doodadDefs.get(areaId)) {
      if (this.#derefDoodad(doodadDef.id) === 0) {
        // A doodad whose model failed to load was never added.
        const model = this.#doodads.get(doodadDef.id);
        model?.dispose();

        this.#doodads.delete(doodadDef.id);
      }
    }

    this.#doodadDefs.delete(areaId);
  }

  /** The model manager the doodads use, shared with the spawns so they animate together */
  dispose() {
    this.#modelManager.dispose();
  }

  get modelManager() {
    return this.#modelManager;
  }

  update(deltaTime: number, camera: THREE.Camera) {
    this.#modelManager.update(deltaTime, camera);
  }

  #refDoodad(refId: number | string) {
    let refCount = this.#doodadRefs.get(refId) || 0;

    refCount++;

    this.#doodadRefs.set(refId, refCount);

    return refCount;
  }

  #derefDoodad(refId: number | string) {
    let refCount = this.#doodadRefs.get(refId);

    // Unknown ref

    if (refCount === undefined) {
      return;
    }

    // Decrement

    refCount--;

    if (refCount > 0) {
      this.#doodadRefs.set(refId, refCount);
      return refCount;
    }

    // Last reference

    this.#doodadRefs.delete(refId);

    return 0;
  }

  async #loadArea(areaId: number, area: MapAreaSpec) {
    this.#doodadDefs.set(areaId, area.doodadDefs);

    // Only load newly referenced doodad defs (defs can be shared across multiple areas)
    const doodadDefs = area.doodadDefs.filter((doodadDef) => this.#refDoodad(doodadDef.id) === 1);

    const areaGroup = new THREE.Group();
    areaGroup.name = 'doodads';

    const areaBounds = new THREE.Sphere();

    // One model that cannot be read must not cost the area every other doodad (and its terrain).
    const doodadResults = await Promise.allSettled(
      doodadDefs.map((doodadDef) => this.#modelManager.get(doodadDef.name)),
    );

    for (let i = 0; i < doodadDefs.length; i++) {
      const result = doodadResults[i];
      const def = doodadDefs[i];

      if (result.status === 'rejected') {
        reportProblem(
          `model:${def.name.toLowerCase()}`,
          `model ${def.name} could not be loaded: ${describeError(result.reason)}`,
        );
        continue;
      }

      const model = result.value;

      // We handle doodad culling ourselves
      model.frustumCulled = false;
      // For its batch (see DoodadBatch)
      model.userData.path = def.name;
      // Inside a building: shown and hidden with the buildings
      model.userData.inside = def.inside === true;

      model.position.set(def.position[0], def.position[1], def.position[2]);
      model.quaternion.set(def.rotation[0], def.rotation[1], def.rotation[2], def.rotation[3]);

      // Def scale is on all axes and is a fixed precision value
      model.scale.setScalar(def.scale / 1024);

      model.updateMatrixWorld();

      areaGroup.add(model);
      areaBounds.union(model.boundingSphereWorld);

      this.#doodads.set(def.id, model);
    }

    this.#areaBounds.set(areaId, areaBounds);

    this.#loadedAreas.set(areaId, areaGroup);
    this.#loadingAreas.delete(areaId);
    // Its doodads start shown: the next cull decides, camera moved or not
    this.#view.mark();

    return areaGroup;
  }
}

export default DoodadManager;

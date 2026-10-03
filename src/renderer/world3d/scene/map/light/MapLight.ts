// @ts-nocheck
import * as THREE from 'three';
import {
  LightFloatBandRecord,
  LightIntBandRecord,
  LightParamsRecord,
  LightRecord,
} from '@wowserhq/format';
import { getDayNightTime, interpolateNumericTable, selectLightsForPosition } from './util.js';
import { SUN_PHI_TABLE, SUN_THETA_TABLE } from './table.js';
import { LIGHT_PARAM } from './const.js';
import { getAreaLightsFromDb } from './db.js';
import { AreaLight, WeightedAreaLight } from './types.js';
import SceneLight from '../../light/SceneLight.js';
import DbManager from '../../db/DbManager.js';
import { blendLights } from './blend.js';

type MapLightOptions = {
  dbManager: DbManager;
};

class MapLight extends SceneLight {
  #dbManager: DbManager;

  // Area lights indexed by map id
  #lights: Record<number, AreaLight[]>;

  // Applicable area lights given current camera position
  #selectedLights: WeightedAreaLight[];

  // Time in half-minutes since midnight (0 - 2879)
  #time = 0;

  // Overridden time in half-minutes since midnight (0 - 2879)
  #timeOverride = null;

  // Time as a floating point range from 0.0 to 1.0
  #timeProgression = 0.0;

  // Used to filter area lights into the set appropriate for the given map
  #mapId: number;

  constructor(options: MapLightOptions) {
    super();

    this.#dbManager = options.dbManager;

    this.#loadLights().catch((error) => console.error(error));
  }

  get mapId() {
    return this.#mapId;
  }

  set mapId(mapId: number) {
    this.#mapId = mapId;
  }

  get time() {
    return this.#time;
  }

  get timeOverride() {
    return this.#timeOverride;
  }

  set timeOverride(override: number) {
    this.#timeOverride = override;
    this.#updateTime();
  }

  update(camera: THREE.Camera) {
    this.#selectLights(camera.position);

    this.#updateTime();
    this.#updateSunDirection();
    this.#updateLights();

    super.update(camera);
  }

  #updateTime() {
    if (this.#timeOverride) {
      this.#time = this.#timeOverride;
    } else {
      this.#time = getDayNightTime();
    }

    this.#timeProgression = this.#time / 2880;
  }

  #updateSunDirection() {
    // Get spherical coordinates
    const phi = interpolateNumericTable(SUN_PHI_TABLE, this.#timeProgression);
    const theta = interpolateNumericTable(SUN_THETA_TABLE, this.#timeProgression);

    // Convert from spherical coordinates to XYZ
    // x = rho * sin(phi) * cos(theta)
    // y = rho * sin(phi) * sin(theta)
    // z = rho * cos(phi)

    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);

    const x = sinPhi * Math.cos(theta);
    const y = sinPhi * Math.sin(theta);
    const z = cosPhi;

    this.sunDir.set(x, y, z);
  }

  #updateLights() {
    if (!this.#selectedLights || this.#selectedLights.length === 0) {
      return;
    }

    const { sunDiffuseColor, sunAmbientColor, fogColor, fogParams } = blendLights(
      this.#selectedLights,
      LIGHT_PARAM.PARAM_STANDARD,
      this.#timeProgression,
    );

    this.sunDiffuseColor.copy(sunDiffuseColor);
    this.sunAmbientColor.copy(sunAmbientColor);
    this.fogColor.copy(fogColor);
    this.fogParams.copy(fogParams);
  }

  #selectLights(position: THREE.Vector3) {
    if (!this.#lights || this.#mapId === undefined || !this.#lights[this.#mapId]) {
      return;
    }

    this.#selectedLights = selectLightsForPosition(this.#lights[this.#mapId], position);
  }

  async #loadLights() {
    const lightDb = await this.#dbManager.get('Light.dbc', LightRecord);
    const lightParamsDb = await this.#dbManager.get('LightParams.dbc', LightParamsRecord);
    const lightIntBandDb = await this.#dbManager.get('LightIntBand.dbc', LightIntBandRecord);
    const lightFloatBandDb = await this.#dbManager.get('LightFloatBand.dbc', LightFloatBandRecord);

    this.#lights = getAreaLightsFromDb(lightDb, lightParamsDb, lightIntBandDb, lightFloatBandDb);
  }
}

export default MapLight;
export { MapLight };

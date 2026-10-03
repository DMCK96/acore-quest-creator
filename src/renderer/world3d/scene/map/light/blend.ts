// @ts-nocheck
import * as THREE from 'three';
import { WeightedAreaLight } from './types.js';
import { interpolateColorTable, interpolateNumericTable } from './util.js';
import { LIGHT_FLOAT_BAND, LIGHT_INT_BAND, LIGHT_PARAM } from './const.js';

const table = {
  sunDiffuseColor: new THREE.Color(),
  sunAmbientColor: new THREE.Color(),
  fogColor: new THREE.Color(),
  fogParams: new THREE.Vector4(),
};

const blend = {
  sunDiffuseColor: new THREE.Color(),
  sunAmbientColor: new THREE.Color(),
  fogColor: new THREE.Color(),
  fogParams: new THREE.Vector4(),
};

const tempColor = new THREE.Color();
const tempVector = new THREE.Vector4();

const addWeightedColor = (color: THREE.Color, add: THREE.Color, weight: number) => {
  color.add(tempColor.copy(add).multiplyScalar(weight));
};

const addWeightedVector = (vector: THREE.Vector4, add: THREE.Vector4, weight: number) => {
  vector.add(tempVector.copy(add).multiplyScalar(weight));
};

const blendLights = (
  weightedLights: WeightedAreaLight[],
  param: LIGHT_PARAM,
  timeProgression: number,
) => {
  blend.sunDiffuseColor.setScalar(0);
  blend.sunAmbientColor.setScalar(0);
  blend.fogColor.setScalar(0);
  blend.fogParams.setScalar(0);

  for (const weightedLight of weightedLights) {
    const { light, weight } = weightedLight;
    const { intBands, floatBands } = light.params[param];

    // Sun

    interpolateColorTable(
      intBands[LIGHT_INT_BAND.BAND_DIRECT_COLOR],
      timeProgression,
      table.sunDiffuseColor,
    );

    addWeightedColor(blend.sunDiffuseColor, table.sunDiffuseColor, weight);

    interpolateColorTable(
      intBands[LIGHT_INT_BAND.BAND_AMBIENT_COLOR],
      timeProgression,
      table.sunAmbientColor,
    );

    addWeightedColor(blend.sunAmbientColor, table.sunAmbientColor, weight);

    // Fog

    interpolateColorTable(
      intBands[LIGHT_INT_BAND.BAND_SKY_FOG_COLOR],
      timeProgression,
      table.fogColor,
    );

    addWeightedColor(blend.fogColor, table.fogColor, weight);

    const fogEnd = interpolateNumericTable(
      floatBands[LIGHT_FLOAT_BAND.BAND_FOG_END],
      timeProgression,
    );

    const fogStartScalar = interpolateNumericTable(
      floatBands[LIGHT_FLOAT_BAND.BAND_FOG_START_SCALAR],
      timeProgression,
    );

    const fogStart = fogStartScalar * fogEnd;
    const fogStep = 1.0 / (fogEnd - fogStart);

    table.fogParams.set(fogStep, fogEnd, 1.0, 1.0);

    addWeightedVector(blend.fogParams, table.fogParams, weight);
  }

  return blend;
};

export { blendLights };

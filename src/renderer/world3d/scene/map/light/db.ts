// @ts-nocheck
import * as THREE from 'three';
import {
  LightFloatBandRecord,
  LightIntBandRecord,
  LightParamsRecord,
  LightRecord,
  MAP_CORNER_X,
  MAP_CORNER_Y,
} from '@wowserhq/format';
import { LIGHT_FLOAT_BAND, LIGHT_INT_BAND } from './const.js';
import { AreaLight } from './types.js';
import type { ClientTable } from '../../db/LazyClientDb.js';

const getAreaLightsFromDb = (
  lightDb: ClientTable<LightRecord>,
  lightParamsDb: ClientTable<LightParamsRecord>,
  lightIntBandDb: ClientTable<LightIntBandRecord>,
  lightFloatBandDb: ClientTable<LightFloatBandRecord>,
) => {
  const lights: Record<number, AreaLight[]> = {};

  for (let i = 0; i < lightDb.records.length; i++) {
    const lightRecord = lightDb.records[i];

    // Lights have their own coordinate system
    const position = new THREE.Vector3(
      MAP_CORNER_X - lightRecord.gameCoords[2] / 36,
      MAP_CORNER_Y - lightRecord.gameCoords[0] / 36,
      lightRecord.gameCoords[1] / 36,
    );

    const falloffStart = lightRecord.gameFalloffStart / 36;
    const falloffEnd = lightRecord.gameFalloffEnd / 36;
    const mapId = lightRecord.continentId;
    const id = lightRecord.id;

    const params = [];
    for (let p = 0; p < lightRecord.lightParamsId.length; p++) {
      const paramId = lightRecord.lightParamsId[p];

      // Unused param
      if (paramId === 0) {
        continue;
      }

      const paramsRecord = lightParamsDb.getRecord(paramId);
      const intBands = getIntBandsForParam(paramId, lightIntBandDb);
      const floatBands = getFloatBandsForParam(paramId, lightFloatBandDb);

      params.push({
        ...paramsRecord,
        intBands,
        floatBands,
      });
    }

    const light: AreaLight = {
      id,
      mapId,
      position,
      falloffStart,
      falloffEnd,
      params,
    };

    if (lights[mapId]) {
      lights[mapId].push(light);
    } else {
      lights[mapId] = [light];
    }
  }

  return lights;
};

const getFloatBandsForParam = (paramId: number, bandDb: ClientTable<LightFloatBandRecord>) => {
  const floatBandCount = LIGHT_FLOAT_BAND.NUM_LIGHT_FLOAT_BANDS;
  const floatBands = new Array(floatBandCount);

  for (let band = 0; band < floatBandCount; band++) {
    const floatBandBase = (paramId - 1) * floatBandCount + 1;
    const floatBandRecord = bandDb.getRecord(floatBandBase + band);
    const floatBand = [];

    for (let b = 0; b < floatBandRecord.num; b++) {
      const time = (floatBandRecord.time[b] >>> 0) / 2880;
      const value =
        band === LIGHT_FLOAT_BAND.BAND_FOG_END
          ? floatBandRecord.data[b] / 36
          : floatBandRecord.data[b];
      floatBand.push(time, value);
    }

    floatBands[band] = floatBand;
  }

  return floatBands;
};

const getIntBandsForParam = (paramId: number, bandDb: ClientTable<LightIntBandRecord>) => {
  const intBandCount = LIGHT_INT_BAND.NUM_LIGHT_INT_BANDS;
  const intBands = new Array(intBandCount);

  for (let band = 0; band < intBandCount; band++) {
    const intBandBase = (paramId - 1) * intBandCount + 1;
    const intBandRecord = bandDb.getRecord(intBandBase + band);
    const intBand = [];

    for (let b = 0; b < intBandRecord.num; b++) {
      const time = (intBandRecord.time[b] >>> 0) / 2880;
      const value = new THREE.Color(intBandRecord.data[b] >>> 0);

      intBand.push(time, value);
    }

    intBands[band] = intBand;
  }

  return intBands;
};

export { getAreaLightsFromDb };

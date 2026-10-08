// @ts-nocheck
import * as THREE from 'three';
import { MAP_CORNER_X, MAP_CORNER_Y } from '@wowserhq/format';
import { AreaLight, WeightedAreaLight } from './types.js';

const clamp = (value: number, min: number, max: number) => {
  return Math.min(Math.max(value, min), max);
};

/**
 * Returns number of half minutes since midnight.
 */
const getDayNightTime = () => {
  const d = new Date();

  const msSinceMidnight = d.getTime() - d.setHours(0, 0, 0, 0);

  return Math.round(msSinceMidnight / 1000.0 / 30.0);
};

/**
 * Given two numbers, linearly interpolate between them according to the given factor.
 *
 * @param value1 - First number
 * @param value2 - Second number
 * @param factor - Interpolation factor
 */
const lerpNumbers = (value1: number, value2: number, factor: number) =>
  (1.0 - factor) * value1 + factor * value2;

/**
 * Given two colors, linearly interpolate between them according to the given factor.
 *
 * @param value1 - First color
 * @param value2 - Second color
 * @param factor - Interpolation factor
 * @param color - Destination color object used to store the result of the interpolation
 */
const lerpColors = (value1: THREE.Color, value2: THREE.Color, factor: number, color: THREE.Color) =>
  color.lerpColors(value1, value2, factor);

const getTableKeys = (table: any[], key: number) => {
  // All table entries are key/value pairs
  const size = table.length / 2;

  // Clamp key
  key = Math.min(Math.max(key, 0.0), 1.0);

  let previous: number;
  let previousKey: number;
  let next: number;
  let nextKey: number;

  for (let i = 0; i < size; i++) {
    // Wrap at end
    if (i + 1 >= size) {
      previous = i;
      previousKey = table[previous * 2];

      next = 0;
      nextKey = table[0] + 1.0;

      break;
    }

    // Found matching stops
    if (table[i * 2] <= key && table[(i + 1) * 2] >= key) {
      previous = i;
      previousKey = table[previous * 2];

      next = i + 1;
      nextKey = table[next * 2];

      break;
    }
  }

  return { previous, previousKey, next, nextKey };
};

/**
 * Given a table of key/value pairs with color values and a key, interpolate table values against
 * the key. If the key is in excess of the table's size, interpolate from the last table value to
 * the first table value.
 *
 * @param table
 * @param key
 * @param color
 */
const interpolateColorTable = (table: any[], key: number, color: THREE.Color): void => {
  if (!table || table.length === 0) {
    return;
  }

  const { previous, previousKey, next, nextKey } = getTableKeys(table, key);

  const previousValue = table[previous * 2 + 1];
  const nextValue = table[next * 2 + 1];

  const keyDistance = nextKey - previousKey;

  // Two keys at the same time: the first one's value as it is. Upstream returned it without writing
  // it to `color`, which then kept whatever the light before had left there
  if (Math.abs(keyDistance) < 0.001) {
    color.copy(previousValue);
    return;
  }

  const factor = (key - previousKey) / keyDistance;

  lerpColors(previousValue, nextValue, factor, color);
};

/**
 * Given a table of key/value pairs with numeric values and a key, interpolate table values against
 * the key. If the key is in excess of the table's size, interpolate from the last table value to
 * the first table value.
 *
 * @param table
 * @param key
 */
const interpolateNumericTable = (table: any[], key: number): number => {
  const { previous, previousKey, next, nextKey } = getTableKeys(table, key);

  const previousValue = table[previous * 2 + 1];
  const nextValue = table[next * 2 + 1];

  const keyDistance = nextKey - previousKey;

  if (Math.abs(keyDistance) < 0.001) {
    return previousValue;
  }

  const factor = (key - previousKey) / keyDistance;

  return lerpNumbers(previousValue, nextValue, factor);
};

const selectLightsForPosition = (
  lights: AreaLight[],
  position: THREE.Vector3,
): WeightedAreaLight[] => {
  const selectedLights = [];

  for (const light of lights) {
    const distance = position.distanceTo(light.position);

    // Include lights if position is within falloff radii
    if (distance <= light.falloffEnd) {
      selectedLights.push({ light, distance, weight: 0.0 });
    }

    // Include default light
    if (
      light.position.x === MAP_CORNER_X &&
      light.position.y === MAP_CORNER_Y &&
      light.falloffEnd === 0.0
    ) {
      selectedLights.push({ light, distance, weight: 0.0 });
    }
  }

  // Sort selected lights by distance (closer -> farther)
  selectedLights.sort(
    (light1: WeightedAreaLight, light2: WeightedAreaLight) => light1.distance - light2.distance,
  );

  // Distribute weights by falloff
  let availableWeight = 1.0;
  for (const selectedLight of selectedLights) {
    if (availableWeight === 0.0) {
      break;
    }

    const { light, distance } = selectedLight;

    // Default light has no falloff
    const falloff =
      light.falloffStart > 0.0 && light.falloffEnd > 0.0
        ? (distance - light.falloffStart) / (light.falloffEnd - light.falloffStart)
        : 0.0;

    const weight = clamp(1.0 - falloff, 0.0, availableWeight);

    selectedLight.weight = weight;
    availableWeight -= weight;
  }

  // Without a default light to take what is left, the weights sum to less than one and the blend (fog
  // colour, sun, fog distance) shrinks towards black. The lights in range share the whole instead
  if (selectedLights.length > 0) {
    const claimed = 1.0 - availableWeight;
    if (claimed > 0.0) {
      for (const selectedLight of selectedLights) selectedLight.weight /= claimed;
    } else {
      selectedLights[0].weight = 1.0;
    }
  }

  return selectedLights;
};

export { getDayNightTime, interpolateColorTable, interpolateNumericTable, selectLightsForPosition };

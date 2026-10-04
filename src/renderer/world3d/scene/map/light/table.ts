// @ts-nocheck
/**
 * Controls the azimuthal angle of the sun. The sun is used as a global directional light to apply
 * diffuse lighting colors in map exteriors.
 */
// prettier-ignore
const SUN_PHI_TABLE = [
  0.0,  Math.PI * 0.70555556,
  0.25, Math.PI * 0.6111111,
  0.5,  Math.PI * 0.70555556,
  0.75, Math.PI * 0.6111111,
];

/**
 * Controls the polar angle of the sun. The sun is used as a global directional light to apply
 * diffuse lighting colors in map exteriors.
 */
// prettier-ignore
const SUN_THETA_TABLE = [
  0.0,  Math.PI * 1.25,
  0.25, Math.PI * 1.25,
  0.5,  Math.PI * 1.25,
  0.75, Math.PI * 1.25,
];

export { SUN_PHI_TABLE, SUN_THETA_TABLE };

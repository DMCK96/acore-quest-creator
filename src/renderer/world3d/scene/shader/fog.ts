// @ts-nocheck
const UNIFORM_FOG_PARAMS = { name: 'fogParams', type: 'vec4' };

const UNIFORM_FOG_COLOR = { name: 'fogColor', type: 'vec3' };

const VARIABLE_FOG_FACTOR = { name: 'vFogFactor', type: 'float' };

const FUNCTION_CALCULATE_FOG_FACTOR = `
float calculateFogFactor(in vec4 params, in float distance) {
  float step = params.x;
  float end = params.y;
  float density = params.z;
  float multiplier = params.w;

  float base = max((distance * -(multiplier * step)) + (end * step), 0.0);
  float factor = 1.0 - clamp(pow(base, density), 0.0, 1.0);

  return factor;
}`;

const FUNCTION_APPLY_FOG = `
void applyFog(inout vec4 color, in vec3 fogColor, in float factor) {
  color = vec4(mix(color.rgb, fogColor.rgb, factor), color.a);
}
`;

export {
  FUNCTION_APPLY_FOG,
  FUNCTION_CALCULATE_FOG_FACTOR,
  UNIFORM_FOG_COLOR,
  UNIFORM_FOG_PARAMS,
  VARIABLE_FOG_FACTOR,
};

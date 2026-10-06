import { FUNCTION_APPLY_FOG, UNIFORM_FOG_COLOR, VARIABLE_FOG_FACTOR } from '../../../shader/fog.js';
import { composeShader } from '../../../shader/util.js';

const FRAGMENT_SHADER_PRECISIONS = ['highp float'];

const FRAGMENT_SHADER_UNIFORMS = [
  { name: 'frame', type: 'sampler2D' },
  // 0 water, 1 ocean, 2 magma, 3 slime (LiquidType.dbc's sound bank)
  { name: 'kind', type: 'int' },
  { name: 'sunDiffuseColor', type: 'vec3' },
  { name: 'sunAmbientColor', type: 'vec3' },
  { name: 'riverColor', type: 'vec3' },
  { name: 'oceanColor', type: 'vec3' },
  // River shallow, river deep, ocean shallow, ocean deep
  { name: 'waterAlphas', type: 'vec4' },
];

const FRAGMENT_SHADER_INPUTS = [
  { name: 'vUv', type: 'vec2' },
  { name: 'vDepth', type: 'float' },
  { name: 'vLight', type: 'float' },
];

const FRAGMENT_SHADER_OUTPUTS = [{ name: 'color', type: 'vec4' }];

// After wow.export's mpv_liquid shader (MIT): water is the light database's tint plus the texture,
// lit; magma and slime are their texture, unlit and solid.
//
// How see-through: the database's shallow alpha at the water's edge, solid where it is deep. The
// database's own deep alpha is lower still (0.5 for rivers, 0.75 for ocean in 3.3.5a), but the client
// also darkens what lies under deep water (LiquidType's darken-depth fields), so deep water reads as
// solid there; without that darkening, the sea floor showed plainly through open ocean
const FRAGMENT_SHADER_MAIN = `
vec3 texel = texture(frame, vUv).rgb;

if (kind >= 2) {
  color = vec4(texel, 1.0);
} else {
  bool ocean = kind == 1;
  vec3 tint = ocean ? oceanColor : riverColor;
  float shallowAlpha = ocean ? waterAlphas.z : waterAlphas.x;

  color.rgb = (tint + texel) * clamp(sunDiffuseColor * vLight + sunAmbientColor, 0.0, 1.0);
  color.a = mix(shallowAlpha, 1.0, vDepth);
}

applyFog(color, ${UNIFORM_FOG_COLOR.name}, ${VARIABLE_FOG_FACTOR.name});
`;

const fragmentShader = (() => {
  const precisions = FRAGMENT_SHADER_PRECISIONS;

  const uniforms = FRAGMENT_SHADER_UNIFORMS.slice(0);
  uniforms.push(UNIFORM_FOG_COLOR);

  const inputs = FRAGMENT_SHADER_INPUTS.slice(0);
  inputs.push(VARIABLE_FOG_FACTOR);

  const outputs = FRAGMENT_SHADER_OUTPUTS.slice(0);

  const functions = [FUNCTION_APPLY_FOG];

  const main = [FRAGMENT_SHADER_MAIN];

  return composeShader(precisions, uniforms, inputs, outputs, functions, main);
})();

export default fragmentShader;

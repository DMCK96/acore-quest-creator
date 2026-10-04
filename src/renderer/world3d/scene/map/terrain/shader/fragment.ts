// @ts-nocheck
import { FUNCTION_APPLY_FOG, UNIFORM_FOG_COLOR, VARIABLE_FOG_FACTOR } from '../../../shader/fog.js';
import { composeShader } from '../../../shader/util.js';

const FRAGMENT_SHADER_PRECISIONS = ['highp float'];

const FRAGMENT_SHADER_UNIFORMS = [
  { name: 'layers[4]', type: 'sampler2D' },
  { name: 'splat', type: 'sampler2D' },
  { name: 'sunDiffuseColor', type: 'vec3' },
  { name: 'sunAmbientColor', type: 'vec3' },
];

const FRAGMENT_SHADER_INPUTS = [
  { name: 'vLayerCoord', type: 'vec2' },
  { name: 'vSplatCoord', type: 'vec2' },
  { name: 'vLight', type: 'float' },
];

const FRAGMENT_SHADER_OUTPUTS = [{ name: 'color', type: 'vec4' }];

const FRAGMENT_SHADER_FUNCTION_BLEND_LAYER = `
vec4 blendLayer(vec4 color, vec4 layer, vec4 blend) {
  return (layer * blend) + ((1.0 - blend) * color);
}
`;

const FRAGMENT_SHADER_FUNCTIONS = [FRAGMENT_SHADER_FUNCTION_BLEND_LAYER];

const FRAGMENT_SHADER_MAIN_LAYER_BLEND = `
vec4 layer;
vec4 blend;

// 1st layer
color = texture(layers[0], vLayerCoord);
blend = texture(splat, vSplatCoord);

// 2nd layer
#if LAYER_COUNT > 1
  layer = texture(layers[1], vLayerCoord);
  color = blendLayer(color, layer, blend.rrrr);
#endif

#if LAYER_COUNT > 2
  layer = texture(layers[2], vLayerCoord);
  color = blendLayer(color, layer, blend.gggg);
#endif

// 3rd layer
#if LAYER_COUNT > 3
  layer = texture(layers[3], vLayerCoord);
  color = blendLayer(color, layer, blend.bbbb);
#endif

// Terrain is always opaque
color.a = 1.0;
`;

const FRAGMENT_SHADER_MAIN_LIGHTING = `
color.rgb *= sunDiffuseColor * vLight + sunAmbientColor;
`;

const FRAGMENT_SHADER_MAIN_FOG = `
// Apply fog
applyFog(color, ${UNIFORM_FOG_COLOR.name}, ${VARIABLE_FOG_FACTOR.name});
`;

const fragmentShader = (() => {
  // Precisions

  const precisions = FRAGMENT_SHADER_PRECISIONS;

  // Uniforms

  const uniforms = FRAGMENT_SHADER_UNIFORMS.slice(0);

  uniforms.push(UNIFORM_FOG_COLOR);

  // Inputs

  const inputs = FRAGMENT_SHADER_INPUTS.slice(0);

  inputs.push(VARIABLE_FOG_FACTOR);

  // Outputs

  const outputs = FRAGMENT_SHADER_OUTPUTS.slice(0);

  // Functions

  const functions = FRAGMENT_SHADER_FUNCTIONS.slice(0);

  functions.push(FUNCTION_APPLY_FOG);

  // Main

  const main = [];

  main.push(FRAGMENT_SHADER_MAIN_LAYER_BLEND);
  main.push(FRAGMENT_SHADER_MAIN_LIGHTING);
  main.push(FRAGMENT_SHADER_MAIN_FOG);

  return composeShader(precisions, uniforms, inputs, outputs, functions, main);
})();

export default fragmentShader;

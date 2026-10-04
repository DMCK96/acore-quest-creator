// @ts-nocheck
import {
  FUNCTION_CALCULATE_FOG_FACTOR,
  UNIFORM_FOG_PARAMS,
  VARIABLE_FOG_FACTOR,
} from '../../../shader/fog.js';
import { composeShader } from '../../../shader/util.js';

const VERTEX_SHADER_PRECISIONS = ['highp float'];

const VERTEX_SHADER_UNIFORMS = [
  { name: 'modelMatrix', type: 'mat4' },
  { name: 'modelViewMatrix', type: 'mat4' },
  { name: 'normalMatrix', type: 'mat3' },
  { name: 'projectionMatrix', type: 'mat4' },
  { name: 'cameraPosition', type: 'vec3 ' },
  { name: 'sunDir', type: 'vec3' },
];

const VERTEX_SHADER_INPUTS = [
  { name: 'position', type: 'vec3' },
  { name: 'normal', type: 'vec3' },
];

const VERTEX_SHADER_OUTPUTS = [
  { name: 'vLayerCoord', type: 'vec2' },
  { name: 'vSplatCoord', type: 'vec2' },
  { name: 'vLight', type: 'float' },
];

const VERTEX_SHADER_FUNCTIONS = [];

const VERTEX_SHADER_MAIN_LAYER_COORD = `
// Terrain tileset textures repeat 8 times over the terrain chunk
vec4 layerScale = vec4(-0.24, -0.24, 0.0, 0.0);
vLayerCoord.xy = position.xy * layerScale.xy;
`;

const VERTEX_SHADER_MAIN_SPLAT_COORD = `
// Splat textures do not repeat over the terrain chunk
vec4 splatScale = vec4(-0.03, -0.03, 0.0, 0.0);
vSplatCoord.yx = position.xy * splatScale.xy;
`;

const VERTEX_SHADER_MAIN_LIGHTING = `
vec3 viewNormal = normalize(normalMatrix * normal);
vLight = clamp(dot(viewNormal, -sunDir), 0.0, 1.0);
`;

const VERTEX_SHADER_MAIN_FOG = `
// Calculate camera distance for fog coloring in fragment shader
vec4 worldPosition = modelMatrix * vec4(position, 1.0);
float cameraDistance = distance(cameraPosition, worldPosition.xyz);
${VARIABLE_FOG_FACTOR.name} = calculateFogFactor(${UNIFORM_FOG_PARAMS.name}, cameraDistance);
`;

const VERTEX_SHADER_MAIN_POSITION = `
gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
`;

const vertexShader = (() => {
  // Precisions

  const precisions = VERTEX_SHADER_PRECISIONS;

  // Uniforms

  const uniforms = VERTEX_SHADER_UNIFORMS.slice(0);

  uniforms.push(UNIFORM_FOG_PARAMS);

  // Inputs

  const inputs = VERTEX_SHADER_INPUTS.slice(0);

  // Outputs

  const outputs = VERTEX_SHADER_OUTPUTS.slice(0);

  outputs.push(VARIABLE_FOG_FACTOR);

  // Functions

  const functions = VERTEX_SHADER_FUNCTIONS.slice(0);

  functions.push(FUNCTION_CALCULATE_FOG_FACTOR);

  // Main

  const main = [];

  main.push(VERTEX_SHADER_MAIN_LAYER_COORD);
  main.push(VERTEX_SHADER_MAIN_SPLAT_COORD);
  main.push(VERTEX_SHADER_MAIN_LIGHTING);
  main.push(VERTEX_SHADER_MAIN_FOG);
  main.push(VERTEX_SHADER_MAIN_POSITION);

  return composeShader(precisions, uniforms, inputs, outputs, functions, main);
})();

export default vertexShader;

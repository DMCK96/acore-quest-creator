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
  { name: 'cameraPosition', type: 'vec3' },
  { name: 'sunDir', type: 'vec3' },
  // Water: scale and rotation (degrees) of the texture; magma and slime: how fast it flows in u and v
  { name: 'uvParams', type: 'vec2' },
  { name: 'flows', type: 'bool' },
  { name: 'time', type: 'float' },
];

const VERTEX_SHADER_INPUTS = [
  { name: 'position', type: 'vec3' },
  { name: 'uv', type: 'vec2' },
  { name: 'depth', type: 'float' },
];

const VERTEX_SHADER_OUTPUTS = [
  { name: 'vUv', type: 'vec2' },
  { name: 'vDepth', type: 'float' },
  { name: 'vLight', type: 'float' },
];

// After wow.export's mpv_liquid shader (MIT): a flow repeats every 1000 / speed milliseconds
const VERTEX_SHADER_FUNCTIONS = [
  `
vec2 flowOffset(float milliseconds, vec2 speed) {
  vec2 offset = vec2(0.0);
  if (abs(speed.x) > 0.001) {
    offset.x = mod(milliseconds, 1000.0 / speed.x) / (1000.0 / speed.x);
  }
  if (abs(speed.y) > 0.001) {
    offset.y = mod(milliseconds, 1000.0 / speed.y) / (1000.0 / speed.y);
  }
  return offset;
}
`,
];

const VERTEX_SHADER_MAIN_UV = `
if (flows) {
  vUv = uv + flowOffset(time * 1000.0, uvParams);
} else {
  float angle = radians(uvParams.y);
  vec2 scaled = uv * uvParams.x;
  vUv = vec2(scaled.x * cos(angle) - scaled.y * sin(angle), scaled.x * sin(angle) + scaled.y * cos(angle));
}
vDepth = depth;
`;

const VERTEX_SHADER_MAIN_LIGHTING = `
// A liquid surface faces straight up
vec3 viewNormal = normalize(normalMatrix * vec3(0.0, 0.0, 1.0));
vLight = clamp(dot(viewNormal, -sunDir), 0.0, 1.0);
`;

const VERTEX_SHADER_MAIN_FOG = `
vec4 worldPosition = modelMatrix * vec4(position, 1.0);
float cameraDistance = distance(cameraPosition, worldPosition.xyz);
${VARIABLE_FOG_FACTOR.name} = calculateFogFactor(${UNIFORM_FOG_PARAMS.name}, cameraDistance);
`;

const VERTEX_SHADER_MAIN_POSITION = `
gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
`;

const vertexShader = (() => {
  const precisions = VERTEX_SHADER_PRECISIONS;

  const uniforms = VERTEX_SHADER_UNIFORMS.slice(0);
  uniforms.push(UNIFORM_FOG_PARAMS);

  const inputs = VERTEX_SHADER_INPUTS.slice(0);

  const outputs = VERTEX_SHADER_OUTPUTS.slice(0);
  outputs.push(VARIABLE_FOG_FACTOR);

  const functions = VERTEX_SHADER_FUNCTIONS.slice(0);
  functions.push(FUNCTION_CALCULATE_FOG_FACTOR);

  const main = [];
  main.push(VERTEX_SHADER_MAIN_UV);
  main.push(VERTEX_SHADER_MAIN_LIGHTING);
  main.push(VERTEX_SHADER_MAIN_FOG);
  main.push(VERTEX_SHADER_MAIN_POSITION);

  return composeShader(precisions, uniforms, inputs, outputs, functions, main);
})();

export default vertexShader;

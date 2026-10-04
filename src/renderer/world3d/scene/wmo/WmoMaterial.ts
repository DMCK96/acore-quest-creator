// @ts-nocheck
/**
 * A building batch's surface, lit by the map's own light (the sun and ambient terrain uses) and fogged
 * like the terrain. A group's baked colours (MOCV) are light added to the ambient, not the whole of
 * it: later buildings (Ascension's Stormwind, its Kul Tiras docks) carry dark or black baked colours
 * that only make sense on top of the sun, and drawing them as the only light left those buildings
 * black. Batches whose material is unlit show their texture as it is.
 *
 * The lighting law (ambient + baked colour + sun × N·L, times the texture) follows
 * Kruithne/wow.export's `mpv_wmo.fragment.shader` and `mpv_light.inc.glsl` (MIT, see
 * ../map/liquid/LICENSE and CREDITS.md at the repository root).
 */
import * as THREE from 'three';
import {
  FUNCTION_APPLY_FOG,
  FUNCTION_CALCULATE_FOG_FACTOR,
  UNIFORM_FOG_COLOR,
  UNIFORM_FOG_PARAMS,
  VARIABLE_FOG_FACTOR,
} from '../shader/fog.js';
import { composeShader } from '../shader/util.js';

const vertexShader = composeShader(
  ['highp float'],
  [
    { name: 'modelMatrix', type: 'mat4' },
    { name: 'modelViewMatrix', type: 'mat4' },
    { name: 'normalMatrix', type: 'mat3' },
    { name: 'projectionMatrix', type: 'mat4' },
    { name: 'cameraPosition', type: 'vec3' },
    { name: 'sunDir', type: 'vec3' },
    UNIFORM_FOG_PARAMS,
  ],
  [
    { name: 'position', type: 'vec3' },
    { name: 'normal', type: 'vec3' },
    { name: 'uv', type: 'vec2' },
    { name: 'color', type: 'vec4', if: 'BAKED' },
  ],
  [
    { name: 'vUv', type: 'vec2' },
    { name: 'vLight', type: 'float' },
    { name: 'vBaked', type: 'vec3' },
    VARIABLE_FOG_FACTOR,
  ],
  [FUNCTION_CALCULATE_FOG_FACTOR],
  [
    `
vUv = uv;

vec3 viewNormal = normalize(normalMatrix * normal);
vLight = clamp(dot(viewNormal, -sunDir), 0.0, 1.0);

#ifdef BAKED
  vBaked = color.rgb;
#else
  vBaked = vec3(0.0);
#endif

vec4 worldPosition = modelMatrix * vec4(position, 1.0);
${VARIABLE_FOG_FACTOR.name} = calculateFogFactor(${UNIFORM_FOG_PARAMS.name}, distance(cameraPosition, worldPosition.xyz));

gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
`,
  ],
);

const fragmentShader = composeShader(
  ['highp float'],
  [
    { name: 'map', type: 'sampler2D' },
    { name: 'sunDiffuseColor', type: 'vec3' },
    { name: 'sunAmbientColor', type: 'vec3' },
    // Fragments less opaque than this are dropped (alpha-keyed batches); 0 keeps them all
    { name: 'alphaCutoff', type: 'float' },
    { name: 'unlit', type: 'bool' },
    { name: 'opaque', type: 'bool' },
    UNIFORM_FOG_COLOR,
  ],
  [
    { name: 'vUv', type: 'vec2' },
    { name: 'vLight', type: 'float' },
    { name: 'vBaked', type: 'vec3' },
    VARIABLE_FOG_FACTOR,
  ],
  [{ name: 'color', type: 'vec4' }],
  [FUNCTION_APPLY_FOG],
  [
    `
vec4 texel = texture(map, vUv);
if (texel.a < alphaCutoff) {
  discard;
}

color.rgb = unlit ? texel.rgb : texel.rgb * (sunAmbientColor + vBaked + sunDiffuseColor * vLight);
color.a = opaque ? 1.0 : texel.a;

applyFog(color, ${UNIFORM_FOG_COLOR.name}, ${VARIABLE_FOG_FACTOR.name});
`,
  ],
);

type WmoMaterialOptions = {
  map: THREE.Texture;
  /** The group has baked colours (a `color` attribute) */
  baked: boolean;
  unlit: boolean;
  /** 0 opaque, 1 alpha-keyed, 2 blended, 3 additive (the material's blend mode) */
  blend: number;
  /** The map's light: sunDir, sunDiffuseColor, sunAmbientColor, fogParams, fogColor */
  uniforms: Record<string, THREE.IUniform>;
};

class WmoMaterial extends THREE.RawShaderMaterial {
  constructor(options: WmoMaterialOptions) {
    super();

    const { blend } = options;

    this.uniforms = {
      ...options.uniforms,
      map: { value: options.map },
      alphaCutoff: { value: blend === 1 ? 0.5 : 0.0 },
      unlit: { value: options.unlit },
      opaque: { value: blend <= 1 },
    };

    if (options.baked) {
      this.defines = { BAKED: 1 };
    }

    this.vertexShader = vertexShader;
    this.fragmentShader = fragmentShader;
    this.glslVersion = THREE.GLSL3;
    // Which way a building's faces wind has to be right for culling; two-sided is right for any
    this.side = THREE.DoubleSide;

    if (blend === 2) {
      this.transparent = true;
    } else if (blend === 3) {
      this.transparent = true;
      this.blending = THREE.AdditiveBlending;
      this.depthWrite = false;
    }
  }
}

export default WmoMaterial;
export { WmoMaterial };

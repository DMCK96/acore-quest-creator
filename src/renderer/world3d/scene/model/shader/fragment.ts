// @ts-nocheck
import { M2_FRAGMENT_SHADER } from '@wowserhq/format';
import { VARIABLE_FOG_FACTOR, FUNCTION_APPLY_FOG, UNIFORM_FOG_COLOR } from '../../shader/fog.js';
import { composeShader } from '../../shader/util.js';

const FRAGMENT_SHADER_PRECISIONS = ['highp float'];

const FRAGMENT_SHADER_UNIFORMS = [
  { name: 'textures[2]', type: 'sampler2D' },
  { name: 'materialParams', type: 'vec4' },
  { name: 'sunDir', type: 'vec3' },
  { name: 'sunDiffuseColor', type: 'vec3' },
  { name: 'sunAmbientColor', type: 'vec3' },
  { name: 'diffuseColor', type: 'vec3' },
  { name: 'emissiveColor', type: 'vec3' },
];

const FRAGMENT_SHADER_INPUTS = [{ name: 'vViewNormal', type: 'vec3' }];

const FRAGMENT_SHADER_OUTPUTS = [{ name: 'color', type: 'vec4' }];

const FRAGMENT_SHADER_FUNCTIONS = [];

const FRAGMENT_SHADER_COMBINERS = `
void combineOpaque(inout vec4 color, in vec4 tex0) {
  color.rgb = color.rgb * tex0.rgb;
}

void combineAdd(inout vec4 color, in vec4 tex0) {
  color.rgb = color.rgb + tex0.rgb;
  color.a = color.a + tex0.a;
}

void combineDecal(inout vec4 color, in vec4 tex0) {
  color.rgb = mix(color.rgb, tex0.rgb, color.a);
}

void combineFade(inout vec4 color, in vec4 tex0) {
  color.rgb = mix(tex0.rgb, color.rgb, color.a);
}

void combineMod(inout vec4 color, in vec4 tex0) {
  color.rgb = color.rgb * tex0.rgb;
  color.a = color.a * tex0.a;
}

void combineMod2x(inout vec4 color, in vec4 tex0) {
  color.rgb = color.rgb * tex0.rgb * 2.0;
  color.a = color.a * tex0.a * 2.0;
}

void combineOpaqueOpaque(inout vec4 color, in vec4 tex0, in vec4 tex1) {
  color.rgb = (color.rgb * tex0.rgb) * tex1.rgb;
}

void combineOpaqueAdd(inout vec4 color, in vec4 tex0, in vec4 tex1) {
  color.rgb = (color.rgb * tex0.rgb) + tex1.rgb;
  color.a = color.a + tex1.a;
}

void combineOpaqueAddAlpha(inout vec4 color, in vec4 tex0, in vec4 tex1) {
  color.rgb = (color.rgb * tex0.rgb) + (tex1.rgb * tex1.a);
}

void combineOpaqueAddAlphaAlpha(inout vec4 color, in vec4 tex0, in vec4 tex1) {
  color.rgb = (color.rgb * tex0.rgb) + (tex1.rgb * tex1.a * tex0.a);
}

void combineOpaqueAddNa(inout vec4 color, in vec4 tex0, in vec4 tex1) {
  color.rgb = (color.rgb * tex0.rgb) + tex1.rgb;
}

void combineOpaqueMod(inout vec4 color, in vec4 tex0, in vec4 tex1) {
  color.rgb = (color.rgb * tex0.rgb) * tex1.rgb;
  color.a = color.a * tex1.a;
}

void combineOpaqueMod2x(inout vec4 color, in vec4 tex0, in vec4 tex1) {
  color.rgb = (color.rgb * tex0.rgb) * tex1.rgb * 2.0;
  color.a = color.a * tex1.a * 2.0;
}

void combineOpaqueMod2xNa(inout vec4 color, in vec4 tex0, in vec4 tex1) {
  color.rgb = (color.rgb * tex0.rgb) * tex1.rgb * 2.0;
}

void combineOpaqueMod2xNaAlpha(inout vec4 color, in vec4 tex0, in vec4 tex1) {
  color.rgb = (color.rgb * tex0.rgb) * mix(tex1.rgb * 2.0, vec3(1.0), tex0.a);
}

void combineModOpaque(inout vec4 color, in vec4 tex0, in vec4 tex1) {
  color.rgb = (color.rgb * tex0.rgb) * tex1.rgb;
  color.a = color.a * tex0.a;
}

void combineModMod(inout vec4 color, in vec4 tex0, in vec4 tex1) {
  color.rgb = (color.rgb * tex0.rgb) * tex1.rgb;
  color.a = (color.a * tex0.a) * tex1.a;
}

void combineModAdd(inout vec4 color, in vec4 tex0, in vec4 tex1) {
  color.rgb = (color.rgb * tex0.rgb) + tex1.rgb;
  color.a = (color.a * tex0.a) + tex1.a;
}

void combineModMod2x(inout vec4 color, in vec4 tex0, in vec4 tex1) {
  color.rgb = (color.rgb * tex0.rgb) * tex1.rgb * 2.0;
  color.a = (color.a * tex0.a) * tex1.a * 2.0;
}

void combineModMod2xNa(inout vec4 color, in vec4 tex0, in vec4 tex1) {
  color.rgb = (color.rgb * tex0.rgb) * tex1.rgb * 2.0;
  color.a = color.a * tex0.a;
}

void combineModAddNa(inout vec4 color, in vec4 tex0, in vec4 tex1) {
  color.rgb = (color.rgb * tex0.rgb) + tex1.rgb;
  color.a = color.a * tex0.a;
}

void combineAddMod(inout vec4 color, in vec4 tex0, in vec4 tex1) {
  color.rgb = (color.rgb + tex0.rgb) * tex1.rgb;
  color.a = (color.a + tex0.a) * tex1.a;
}

void combineMod2xMod2x(inout vec4 color, in vec4 tex0, in vec4 tex1) {
  color.rgb = (color.rgb * tex0.rgb * 2.0) * tex1.rgb * 2.0;
  color.a = (color.a * tex0.a * 2.0) * tex1.a * 2.0;
}
`;

const FRAGMENT_SHADER_MAIN_ALPHATEST = `
// Alpha test
#ifdef ALPHA_TO_COVERAGE
  color.a = smoothstep(materialParams.y, materialParams.y + fwidth(color.a), color.a);
  if (color.a == 0.0) {
    discard;
  }
#else
  if (color.a < materialParams.y) {
    discard;
  }
#endif
`;

const FRAGMENT_SHADER_MAIN_LIGHTING = `
vec3 viewNormal = vViewNormal;

#ifdef DOUBLE_SIDED
  float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
  viewNormal *= faceDirection;
#endif

float lightFactor = clamp(dot(viewNormal, -sunDir), 0.0, 1.0);

vec3 sunColor = clamp((sunDiffuseColor * lightFactor) + sunAmbientColor, 0.0, 1.0);
color.rgb = mix(color.rgb, color.rgb * sunColor, materialParams.z);
`;

const FRAGMENT_SHADER_MAIN_COLOR = `
color.rgb = clamp((color.rgb * diffuseColor.rgb) + emissiveColor.rgb, 0.0, 1.0);
color.a = materialParams.x;
`;

const FRAGMENT_SHADER_MAIN_FOG = `
// Apply fog
applyFog(color, ${UNIFORM_FOG_COLOR.name}, ${VARIABLE_FOG_FACTOR.name} * materialParams.w);
`;

const createFragmentShader = (textureCount: number, combineFunction: string) => {
  // Precisions

  const precisions = FRAGMENT_SHADER_PRECISIONS;

  // Uniforms

  const uniforms = FRAGMENT_SHADER_UNIFORMS.slice(0);

  uniforms.push(UNIFORM_FOG_COLOR);

  // Inputs

  const inputs = FRAGMENT_SHADER_INPUTS.slice(0);

  if (textureCount === 1) {
    inputs.push({ name: 'vTexCoord1', type: 'vec2' });
  } else if (textureCount === 2) {
    inputs.push({ name: 'vTexCoord1', type: 'vec2' });
    inputs.push({ name: 'vTexCoord2', type: 'vec2' });
  }

  inputs.push(VARIABLE_FOG_FACTOR);

  // Outputs

  const outputs = FRAGMENT_SHADER_OUTPUTS.slice(0);

  // Functions

  const functions = FRAGMENT_SHADER_FUNCTIONS.slice(0);

  functions.push(FUNCTION_APPLY_FOG);
  functions.push(FRAGMENT_SHADER_COMBINERS);

  // Main

  const main = [];

  main.push(`color.rgba = vec4(1.0, 1.0, 1.0, 1.0);`);

  main.push(FRAGMENT_SHADER_MAIN_LIGHTING);

  main.push(FRAGMENT_SHADER_MAIN_COLOR);

  if (textureCount === 1) {
    main.push(`vec4 tex0 = texture(textures[0], vTexCoord1);`);
    main.push(`${combineFunction}(color, tex0);`);
  } else if (textureCount === 2) {
    main.push(`vec4 tex0 = texture(textures[0], vTexCoord1);`);
    main.push(`vec4 tex1 = texture(textures[1], vTexCoord2);`);
    main.push(`${combineFunction}(color, tex0, tex1);`);
  }

  main.push(FRAGMENT_SHADER_MAIN_ALPHATEST);

  main.push(FRAGMENT_SHADER_MAIN_FOG);

  return composeShader(precisions, uniforms, inputs, outputs, functions, main);
};

// prettier-ignore
const FRAGMENT_SHADER = {
  [M2_FRAGMENT_SHADER.FRAGMENT_OPAQUE]: createFragmentShader(1, 'combineOpaque'),
  [M2_FRAGMENT_SHADER.FRAGMENT_MOD]: createFragmentShader(1, 'combineMod'),
  [M2_FRAGMENT_SHADER.FRAGMENT_DECAL]: createFragmentShader(1, 'combineDecal'),
  [M2_FRAGMENT_SHADER.FRAGMENT_ADD]: createFragmentShader(1, 'combineAdd'),
  [M2_FRAGMENT_SHADER.FRAGMENT_MOD2X]: createFragmentShader(1, 'combineMod2x'),
  [M2_FRAGMENT_SHADER.FRAGMENT_FADE]: createFragmentShader(1, 'combineFade'),
  [M2_FRAGMENT_SHADER.FRAGMENT_OPAQUE_OPAQUE]: createFragmentShader(2, 'combineOpaqueOpaque'),
  [M2_FRAGMENT_SHADER.FRAGMENT_OPAQUE_ADD]: createFragmentShader(2, 'combineOpaqueAdd'),
  [M2_FRAGMENT_SHADER.FRAGMENT_OPAQUE_ADDALPHA]: createFragmentShader(2, 'combineOpaqueAddAlpha'),
  [M2_FRAGMENT_SHADER.FRAGMENT_OPAQUE_ADDALPHA_ALPHA]: createFragmentShader(2, 'combineOpaqueAddAlphaAlpha'),
  [M2_FRAGMENT_SHADER.FRAGMENT_OPAQUE_MOD2X]: createFragmentShader(2, 'combineOpaqueMod2x'),
  [M2_FRAGMENT_SHADER.FRAGMENT_OPAQUE_MOD2XNA]: createFragmentShader(2, 'combineOpaqueMod2xNa'),
  [M2_FRAGMENT_SHADER.FRAGMENT_OPAQUE_MOD2XNA_ALPHA]: createFragmentShader(2, 'combineOpaqueMod2xNaAlpha'),
  [M2_FRAGMENT_SHADER.FRAGMENT_OPAQUE_ADDNA]: createFragmentShader(2, 'combineOpaqueAddNa'),
  [M2_FRAGMENT_SHADER.FRAGMENT_OPAQUE_MOD]: createFragmentShader(2, 'combineOpaqueMod'),
  [M2_FRAGMENT_SHADER.FRAGMENT_MOD_OPAQUE]: createFragmentShader(2, 'combineModOpaque'),
  [M2_FRAGMENT_SHADER.FRAGMENT_MOD_MOD]: createFragmentShader(2, 'combineModMod'),
  [M2_FRAGMENT_SHADER.FRAGMENT_MOD_ADD]: createFragmentShader(2, 'combineModAdd'),
  [M2_FRAGMENT_SHADER.FRAGMENT_MOD_MOD2X]: createFragmentShader(2, 'combineModMod2x'),
  [M2_FRAGMENT_SHADER.FRAGMENT_MOD_MOD2XNA]: createFragmentShader(2, 'combineModMod2xNa'),
  [M2_FRAGMENT_SHADER.FRAGMENT_MOD_ADDNA]: createFragmentShader(2, 'combineModAddNa'),
  [M2_FRAGMENT_SHADER.FRAGMENT_ADD_MOD]: createFragmentShader(2, 'combineAddMod'),
  [M2_FRAGMENT_SHADER.FRAGMENT_MOD2X_MOD2X]: createFragmentShader(2, 'combineMod2xMod2x'),
  [M2_FRAGMENT_SHADER.FRAGMENT_UNKNOWN]: createFragmentShader(0, ''),
};

const getFragmentShader = (shader: M2_FRAGMENT_SHADER) => {
  if (FRAGMENT_SHADER[shader]) {
    return FRAGMENT_SHADER[shader];
  }

  console.warn(`model: unimplemented fragment shader ${M2_FRAGMENT_SHADER[shader]}`);

  return FRAGMENT_SHADER[M2_FRAGMENT_SHADER.FRAGMENT_UNKNOWN];
};

export { getFragmentShader };

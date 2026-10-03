// @ts-nocheck
import * as THREE from 'three';
import { M2_MATERIAL_BLEND, M2_MATERIAL_FLAG } from '@wowserhq/format';
import {
  M2_MATERIAL_BLEND_TO_THREE_BLEND_OPAQUE,
  M2_MATERIAL_BLEND_TO_THREE_BLEND_TRANSPARENT,
} from './const.js';
import { THREE_BLEND_STATE } from '../blend.js';
import Model from './Model.js';
import ModelSkeleton from './ModelSkeleton.js';

const DEFAULT_BLEND: M2_MATERIAL_BLEND = M2_MATERIAL_BLEND.BLEND_OPAQUE;
const DEFAULT_FLAGS: number = 0x0;
const DEFAULT_ALPHA: number = 1.0;

const _tempColor = new THREE.Color();

class ModelMaterial extends THREE.RawShaderMaterial {
  #textureWeightIndex: number;
  #textureTransformIndices: number[];
  #textureTransforms: THREE.Matrix4[];

  #blend: M2_MATERIAL_BLEND;
  #materialParams: THREE.Vector4;

  #colorIndex: number;
  #diffuseColor: THREE.Color;
  #emissiveColor: THREE.Color;

  constructor(
    vertexShader: string,
    fragmentShader: string,
    textures: THREE.Texture[],
    textureWeightIndex: number,
    textureTransformIndices: number[],
    colorIndex: number,
    skinned: boolean = false,
    boneInfluences: number = 0,
    uniforms: Record<string, THREE.IUniform> = {},
    blend = DEFAULT_BLEND,
    flags = DEFAULT_FLAGS,
  ) {
    super();

    this.#textureWeightIndex = textureWeightIndex;
    this.#textureTransformIndices = textureTransformIndices;

    this.#blend = blend;
    this.#materialParams = new THREE.Vector4(0.0, 0.0, 0.0, 0.0);

    this.#colorIndex = colorIndex;

    if (this.#blend === M2_MATERIAL_BLEND.BLEND_MOD) {
      this.#diffuseColor = new THREE.Color(0.0, 0.0, 0.0);
      this.#emissiveColor = new THREE.Color(1.0, 1.0, 1.0);
    } else if (this.#blend === M2_MATERIAL_BLEND.BLEND_MOD2X) {
      this.#diffuseColor = new THREE.Color(0.0, 0.0, 0.0);
      this.#emissiveColor = new THREE.Color(0.5, 0.5, 0.5);
    } else {
      this.#diffuseColor = new THREE.Color(1.0, 1.0, 1.0);
      this.#emissiveColor = new THREE.Color(0.0, 0.0, 0.0);
    }

    this.side = flags & M2_MATERIAL_FLAG.FLAG_TWO_SIDED ? THREE.DoubleSide : THREE.FrontSide;
    this.depthTest = !(flags & M2_MATERIAL_FLAG.FLAG_DISABLE_DEPTH_TEST);
    this.depthWrite = !(flags & M2_MATERIAL_FLAG.FLAG_DISABLE_DEPTH_WRITE);
    this.lit = flags & M2_MATERIAL_FLAG.FLAG_DISABLE_LIGHTING ? 0.0 : 1.0;
    this.fogged = flags & M2_MATERIAL_FLAG.FLAG_DISABLE_FOG ? 0.0 : 1.0;
    this.alpha = DEFAULT_ALPHA;

    if (this.side === THREE.DoubleSide) {
      this.defines['DOUBLE_SIDED'] = 1;
    }

    if (skinned) {
      this.defines['USE_SKINNING'] = 1;
      this.defines['BONE_INFLUENCES'] = boneInfluences;
    }

    if (this.#blend === M2_MATERIAL_BLEND.BLEND_ALPHA_KEY) {
      this.defines['ALPHA_TO_COVERAGE'] = 1;
      this.alphaToCoverage = true;
    }

    this.glslVersion = THREE.GLSL3;
    this.vertexShader = vertexShader;
    this.fragmentShader = fragmentShader;

    this.#updateBlending();

    this.uniforms = {
      ...uniforms,
      textures: { value: textures },
      materialParams: { value: this.#materialParams },
      diffuseColor: { value: this.#diffuseColor },
      emissiveColor: { value: this.#emissiveColor },
    };

    this.#setupTextureTransforms();
  }

  get alpha() {
    return this.#materialParams.x;
  }

  set alpha(alpha: number) {
    if (this.#materialParams.x === alpha) {
      return;
    }

    this.#materialParams.x = alpha;

    // Alpha test behavior
    if (this.#blend === M2_MATERIAL_BLEND.BLEND_OPAQUE) {
      // Disable alpha test
      this.#materialParams.y = 0.0;
    } else if (this.#blend === M2_MATERIAL_BLEND.BLEND_ALPHA_KEY) {
      if (Math.trunc(alpha * 224.0) >= 1) {
        // Scale alpha test by current alpha value
        this.#materialParams.y = alpha * (224.0 / 255.0);
      } else {
        // Disable alpha test
        this.#materialParams.y = 0.0;
      }
    } else {
      // Lower alpha test threshold
      this.#materialParams.y = 1.0 / 255.0;
    }

    this.uniformsNeedUpdate = true;

    this.#updateBlending();
  }

  get alphaRef() {
    return this.#materialParams.y;
  }

  get fogged() {
    return this.#materialParams.w;
  }

  set fogged(fogged: number) {
    this.#materialParams.setW(fogged);
  }

  get lit() {
    return this.#materialParams.z;
  }

  set lit(lit: number) {
    this.#materialParams.setZ(lit);
  }

  set skeleton(skeleton: ModelSkeleton) {
    this.uniforms.boneTexture = { value: skeleton.boneTexture };
  }

  prepareMaterial(model: Model) {
    const { animation } = model;

    // Colors and weights

    const materialColor = animation.materialColors[this.#colorIndex];
    const textureWeight = animation.textureWeights[this.#textureWeightIndex] ?? 1.0;

    if (materialColor) {
      _tempColor.copy(model.diffuseColor).multiply(materialColor.color);
    } else {
      _tempColor.copy(model.diffuseColor);
    }

    this.#setDiffuseColor(_tempColor);
    this.#setEmissiveColor(model.emissiveColor);

    if (materialColor) {
      this.alpha = model.alpha * textureWeight * materialColor.alpha;
    } else {
      this.alpha = model.alpha * textureWeight;
    }

    // Texture transforms

    for (let i = 0; i < this.#textureTransformIndices.length; i++) {
      const transformIndex = this.#textureTransformIndices[i];
      // A transform with no animation state (none of its tracks has keys, so none was made) leaves
      // the texture where it is; reading it used to throw and stop the whole view
      const transform = animation.textureTransforms[transformIndex];
      if (!transform) {
        continue;
      }
      const { translation, rotation, scaling } = transform;
      this.#setTextureTransform(i, translation, rotation, scaling);
    }
  }

  #setDiffuseColor(color: THREE.Color) {
    // Materials using BLEND_MOD and BLEND_MOD2X use hardcoded colors
    if (
      this.#blend === M2_MATERIAL_BLEND.BLEND_MOD ||
      this.#blend === M2_MATERIAL_BLEND.BLEND_MOD2X
    ) {
      return;
    }

    if (this.#diffuseColor.equals(color)) {
      return;
    }

    this.#diffuseColor.copy(color);
    this.uniformsNeedUpdate = true;
  }

  #setEmissiveColor(color: THREE.Color) {
    // Materials using BLEND_MOD and BLEND_MOD2X use hardcoded colors
    if (
      this.#blend === M2_MATERIAL_BLEND.BLEND_MOD ||
      this.#blend === M2_MATERIAL_BLEND.BLEND_MOD2X
    ) {
      return;
    }

    if (this.#emissiveColor.equals(color)) {
      return;
    }

    this.#emissiveColor.copy(color);
    this.uniformsNeedUpdate = true;
  }

  #setTextureTransform(
    index: number,
    translation: THREE.Vector3,
    rotation: THREE.Quaternion,
    scaling: THREE.Vector3,
  ) {
    this.#textureTransforms[index].compose(translation, rotation, scaling);
    this.uniformsNeedUpdate = true;
  }

  #setupTextureTransforms() {
    if (this.#textureTransformIndices.length === 0) {
      return;
    }

    this.#textureTransforms = [new THREE.Matrix4(), new THREE.Matrix4()];

    this.uniforms.textureTransforms = { value: this.#textureTransforms };

    this.defines['TEXTURE_TRANSFORMS'] = this.#textureTransforms.length;
  }

  #updateBlending() {
    // Adjust OPAQUE and ALPHA_KEY blends if the material's alpha value is below 1.0
    const isOpaque = this.#blend <= M2_MATERIAL_BLEND.BLEND_ALPHA_KEY && this.alpha >= 0.99998999;
    const threeBlend = isOpaque
      ? M2_MATERIAL_BLEND_TO_THREE_BLEND_OPAQUE[this.#blend]
      : M2_MATERIAL_BLEND_TO_THREE_BLEND_TRANSPARENT[this.#blend];
    const threeBlendState = THREE_BLEND_STATE[threeBlend];

    const { blending, blendSrc, blendDst, blendSrcAlpha, blendDstAlpha } = threeBlendState;
    const transparent = blending !== THREE.NoBlending;

    this.blending = blending;
    this.blendSrc = blendSrc;
    this.blendDst = blendDst;
    this.blendSrcAlpha = blendSrcAlpha;
    this.blendDstAlpha = blendDstAlpha;
    this.transparent = transparent;
  }
}

export default ModelMaterial;

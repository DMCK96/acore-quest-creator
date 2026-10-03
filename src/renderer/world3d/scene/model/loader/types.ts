// @ts-nocheck
import {
  M2_FRAGMENT_SHADER,
  M2_MATERIAL_BLEND,
  M2_TEXTURE_COMPONENT,
  M2_VERTEX_SHADER,
  M2Color,
  M2TextureTransform,
  M2TextureWeight,
  M2Track,
} from '@wowserhq/format';

type ModelBounds = {
  extent: Float32Array;
  center: Float32Array;
  radius: number;
};

type TextureSpec = {
  flags: number;
  component: M2_TEXTURE_COMPONENT;
  path: string;
};

type MaterialSpec = {
  flags: number;
  textures: TextureSpec[];
  textureWeightIndex: number;
  textureTransformIndices: number[];
  materialColorIndex: number;
  vertexShader: M2_VERTEX_SHADER;
  fragmentShader: M2_FRAGMENT_SHADER;
  blend: M2_MATERIAL_BLEND;
  boneInfluences: number;
};

type GroupSpec = {
  start: number;
  count: number;
  materialIndex: number;
  geosetId: number;
};

type GeometrySpec = {
  bounds: ModelBounds;
  vertexBuffer: ArrayBuffer;
  indexBuffer: ArrayBuffer;
  groups: GroupSpec[];
};

type SequenceSpec = {
  id: number;
  variationIndex: number;
  duration: number;
  moveSpeed: number;
  flags: number;
  frequency: number;
  blendTime: number;
  variationNext: number;
  aliasNext: number;
};

type BoneSpec = {
  flags: number;
  parentIndex: number;
  pivot: Float32Array;
  translationTrack: M2Track<Float32Array>;
  rotationTrack: M2Track<Int16Array>;
  scaleTrack: M2Track<Float32Array>;
};

type ModelSpec = {
  name: string;
  geometry: GeometrySpec;
  materials: MaterialSpec[];
  bones: BoneSpec[];
  skinned: boolean;
  sequences: SequenceSpec[];
  bounds: ModelBounds;
  loops: Uint32Array;
  textureWeights: M2TextureWeight[];
  textureTransforms: M2TextureTransform[];
  materialColors: M2Color[];
};

export { ModelBounds, ModelSpec, BoneSpec, MaterialSpec, TextureSpec, SequenceSpec };

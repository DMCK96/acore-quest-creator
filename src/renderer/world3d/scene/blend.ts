// @ts-nocheck
import * as THREE from 'three';

enum THREE_BLEND {
  BLEND_OPAQUE = 0,
  BLEND_ALPHA_KEY,
  BLEND_ALPHA,
  BLEND_NO_ALPHA_ADD,
  BLEND_ADD,
  BLEND_MOD,
  BLEND_MOD2X,
}

const THREE_BLEND_STATE = {
  [THREE_BLEND.BLEND_OPAQUE]: {
    blending: THREE.NoBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.ZeroFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.ZeroFactor,
  },
  [THREE_BLEND.BLEND_ALPHA_KEY]: {
    blending: THREE.CustomBlending,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  },
  [THREE_BLEND.BLEND_ALPHA]: {
    blending: THREE.CustomBlending,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  },
  [THREE_BLEND.BLEND_NO_ALPHA_ADD]: {
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  },
  [THREE_BLEND.BLEND_ADD]: {
    blending: THREE.CustomBlending,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  },
  [THREE_BLEND.BLEND_MOD]: {
    blending: THREE.CustomBlending,
    blendSrc: THREE.DstColorFactor,
    blendDst: THREE.ZeroFactor,
    blendSrcAlpha: THREE.DstAlphaFactor,
    blendDstAlpha: THREE.ZeroFactor,
  },
  [THREE_BLEND.BLEND_MOD2X]: {
    blending: THREE.CustomBlending,
    blendSrc: THREE.DstColorFactor,
    blendDst: THREE.SrcColorFactor,
    blendSrcAlpha: THREE.DstAlphaFactor,
    blendDstAlpha: THREE.SrcAlphaFactor,
  },
};

export { THREE_BLEND, THREE_BLEND_STATE };

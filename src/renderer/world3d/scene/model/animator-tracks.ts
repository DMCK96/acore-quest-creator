import * as THREE from 'three';
import ModelAnimator from './ModelAnimator.js';
import type { ModelSpec } from './loader/types.js';
import type { ModelMaterialColor, ModelTextureTransform } from './types.js';

/** A track's property, named as the animation state it drives has it, so a misspelt one does not compile */
const textureTransform = (property: keyof ModelTextureTransform) => property;
const materialColor = (property: keyof ModelMaterialColor) => property;

/** A bone rotation's keys are packed shorts: 0x7fff is 1, with the sign folded the game's way */
const unpackBoneRotation = (value: number) => (value > 0 ? value - 0x7fff : value + 0x7fff) / 0x7fff;
const unpackFixed16 = (value: number) => value / 0x7fff;

/**
 * Whether a model's texture weights do anything: a single weight held at 1 is how most models say
 * "no weight animation", and registering it would only cost an update each frame.
 */
function hasTextureWeights(spec: ModelSpec): boolean {
  const first = spec.textureWeights[0]?.weightTrack;
  return (
    spec.textureWeights.length > 1 ||
    (first?.sequenceKeys.length ?? 0) > 1 ||
    (first?.sequenceKeys[0]?.length ?? 0) > 1 ||
    first?.sequenceKeys[0]?.[0] !== 0x7fff
  );
}

/** The animator for a model, with a track for each animated texture weight, texture transform, colour and bone; null when it has no animation */
export function createAnimator(spec: ModelSpec): ModelAnimator | null {
  if (spec.loops.length === 0 && spec.sequences.length === 0) return null;

  const animator = new ModelAnimator(spec.loops, spec.sequences, spec.skinned ? spec.bones : []);

  if (hasTextureWeights(spec)) {
    for (const [index, weight] of spec.textureWeights.entries()) {
      animator.registerTrack({ state: 'textureWeights', index }, weight.weightTrack, THREE.NumberKeyframeTrack, unpackFixed16);
    }
  }

  for (const [index, transform] of spec.textureTransforms.entries()) {
    const state = 'textureTransforms';
    animator.registerTrack({ state, index, property: textureTransform('translation') }, transform.translationTrack, THREE.VectorKeyframeTrack);
    animator.registerTrack({ state, index, property: textureTransform('rotation') }, transform.rotationTrack, THREE.QuaternionKeyframeTrack);
    animator.registerTrack({ state, index, property: textureTransform('scaling') }, transform.scalingTrack, THREE.VectorKeyframeTrack);
  }

  for (const [index, color] of spec.materialColors.entries()) {
    const state = 'materialColors';
    animator.registerTrack({ state, index, property: materialColor('color') }, color.colorTrack, THREE.ColorKeyframeTrack);
    animator.registerTrack({ state, index, property: materialColor('alpha') }, color.alphaTrack, THREE.NumberKeyframeTrack, unpackFixed16);
  }

  for (const [index, bone] of spec.bones.entries()) {
    const state = 'bones';
    animator.registerTrack({ state, index, property: 'translation' }, bone.translationTrack, THREE.VectorKeyframeTrack);
    animator.registerTrack({ state, index, property: 'rotation' }, bone.rotationTrack, THREE.QuaternionKeyframeTrack, unpackBoneRotation);
    animator.registerTrack({ state, index, property: 'scale' }, bone.scaleTrack, THREE.VectorKeyframeTrack);
  }

  return animator;
}

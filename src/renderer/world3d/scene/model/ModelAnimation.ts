// @ts-nocheck
import * as THREE from 'three';
import { ModelMaterialColor, ModelTextureTransform } from './types.js';
import Model from './Model.js';
import ModelAnimator from './ModelAnimator.js';
import { BoneSpec } from './loader/types.js';
import ModelSkeleton from './ModelSkeleton.js';
import ModelBone from './ModelBone.js';

class ModelAnimation extends THREE.Object3D {
  // States
  textureWeights: number[] = [];
  textureTransforms: ModelTextureTransform[] = [];
  materialColors: ModelMaterialColor[] = [];

  // Skeleton
  skeleton: ModelSkeleton;

  #model: Model;
  #animator: ModelAnimator;
  #actions: Set<THREE.AnimationAction> = new Set();
  #playingActions: Set<THREE.AnimationAction> = new Set();
  #suspendedActions: Set<THREE.AnimationAction> = new Set();

  constructor(
    model: Model,
    animator: ModelAnimator,
    bones: BoneSpec[],
    stateCounts: Record<string, number>,
  ) {
    super();

    this.#model = model;
    this.#animator = animator;
    this.#createStates(stateCounts);
    this.#createSkeleton(bones);

    this.#autoplay();
  }

  dispose() {
    for (const action of this.#actions.values()) {
      this.#animator.clearAction(action);
    }

    this.#animator.clearAnimation(this);

    this.#actions.clear();
    this.#playingActions.clear();
    this.#suspendedActions.clear();

    if (this.skeleton) {
      this.skeleton.dispose();
    }
  }

  resume() {
    for (const action of this.#suspendedActions) {
      action.enabled = true;
      (action.getMixer() as any)._activateAction(action);

      this.#suspendedActions.delete(action);
      this.#playingActions.add(action);
    }
  }

  suspend() {
    for (const action of this.#playingActions) {
      action.enabled = false;
      (action.getMixer() as any)._deactivateAction(action);

      this.#playingActions.delete(action);
      this.#suspendedActions.add(action);
    }
  }

  #createStates(stateCounts: Record<string, number>) {
    for (let i = 0; i < stateCounts.textureWeights; i++) {
      this.textureWeights.push(1.0);
    }

    for (let i = 0; i < stateCounts.textureTransforms; i++) {
      this.textureTransforms.push({
        translation: new THREE.Vector3(),
        rotation: new THREE.Quaternion(),
        scaling: new THREE.Vector3(1.0, 1.0, 1.0),
      });
    }

    for (let i = 0; i < stateCounts.materialColors; i++) {
      this.materialColors.push({
        color: new THREE.Color(1.0, 1.0, 1.0),
        alpha: 1.0,
      });
    }
  }

  #createSkeleton(boneSpecs: BoneSpec[]) {
    if (boneSpecs.length === 0) {
      return;
    }

    const bones: ModelBone[] = [];

    for (const boneSpec of boneSpecs) {
      const flags = boneSpec.flags;
      const parent = bones[boneSpec.parentIndex] ?? null;
      const pivot = new THREE.Vector3(boneSpec.pivot[0], boneSpec.pivot[1], boneSpec.pivot[2]);
      const bone = new ModelBone(flags, parent, pivot);

      bones.push(bone);
    }

    this.skeleton = new ModelSkeleton(this.#model, bones);
  }

  #autoplay() {
    // Automatically play all loops
    for (let i = 0; i < this.#animator.loops.length; i++) {
      const action = this.#animator.getLoop(this, i);
      action.play();

      this.#actions.add(action);
      this.#playingActions.add(action);
    }

    // Automatically play sequence id 0
    if (this.#animator.sequences.has(0)) {
      // Variations are stored by their index, and some models start past 0 (stand as only 1 and 2)
      const variations = this.#animator.sequences.get(0);
      const sequence = variations.find((variation) => variation !== undefined);

      if (sequence && sequence.flags & 0x20) {
        const action = this.#animator.getSequence(this, sequence.id, sequence.variationIndex);
        action.play();

        this.#actions.add(action);
        this.#playingActions.add(action);
      }
    }
  }
}

export default ModelAnimation;

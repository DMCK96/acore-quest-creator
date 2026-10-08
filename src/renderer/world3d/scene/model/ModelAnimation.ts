// @ts-nocheck
import * as THREE from 'three';
import { ModelMaterialColor, ModelTextureTransform } from './types.js';
import Model from './Model.js';
import ModelAnimator from './ModelAnimator.js';
import { BoneSpec } from './loader/types.js';
import ModelSkeleton from './ModelSkeleton.js';
import ModelBone from './ModelBone.js';

export type Gait = 'stand' | 'walk' | 'run';

/** WoW animation ids of the gaits */
const GAIT_SEQUENCE: Record<Gait, number> = { stand: 0, walk: 4, run: 5 };
/** Each gait falls back to the next when a model has no such animation; stand is the floor */
const GAIT_FALLBACK: Record<Gait, Gait | null> = { run: 'walk', walk: 'stand', stand: null };
const GAIT_FADE = 0.15;

class ModelAnimation extends THREE.Object3D {
  // States
  textureWeights: number[] = [];
  textureTransforms: ModelTextureTransform[] = [];
  materialColors: ModelMaterialColor[] = [];

  /** Held on its last pose because it is too far to see move: its actions are not run */
  frozen = false;

  // Skeleton
  skeleton: ModelSkeleton;

  /** The gait playing, after fallback */
  gait: Gait = 'stand';

  #model: Model;
  #held = false;
  #gaitActions: Partial<Record<Gait, THREE.AnimationAction>> = {};
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
    this.#gaitActions = {};
    this.#playingActions.clear();
    this.#suspendedActions.clear();

    if (this.skeleton) {
      this.skeleton.dispose();
    }
  }

  /** Holds the animation still, or lets it run again; a model that is hidden is held anyway, see `suspend` */
  freeze(frozen: boolean) {
    if (frozen === this.frozen) return;
    if (frozen) this.suspend();
    else this.resume();
    this.frozen = frozen;
  }

  /** Crossfades to a gait, or the nearest one the model has; a held animation starts it on `resume` */
  setGait(wanted: Gait) {
    let gait: Gait = wanted;
    while (!this.#animator.sequences.has(GAIT_SEQUENCE[gait]) && GAIT_FALLBACK[gait]) {
      gait = GAIT_FALLBACK[gait];
    }
    if (gait === this.gait) return;

    const outgoing = this.#gaitActions[this.gait];
    const incoming = this.#gaitActions[gait] ?? this.#startGait(gait);
    this.gait = gait;

    if (outgoing) this.#retire(outgoing);
    if (!incoming) return;

    incoming.reset();
    if (this.#held) {
      this.#playingActions.delete(incoming);
      this.#suspendedActions.add(incoming);
    } else {
      incoming.fadeIn(GAIT_FADE).play();
      this.#suspendedActions.delete(incoming);
      this.#playingActions.add(incoming);
    }
  }

  resume() {
    this.#held = false;
    this.frozen = false;
    for (const action of this.#suspendedActions) {
      action.enabled = true;
      (action.getMixer() as any)._activateAction(action);

      this.#suspendedActions.delete(action);
      this.#playingActions.add(action);
    }
  }

  suspend() {
    this.#held = true;
    for (const action of this.#playingActions) {
      action.enabled = false;
      (action.getMixer() as any)._deactivateAction(action);

      this.#playingActions.delete(action);
      this.#suspendedActions.add(action);
    }
  }

  /** Fades an action out, or switches it off at once while held */
  #retire(action: THREE.AnimationAction) {
    if (this.#held) {
      this.#suspendedActions.delete(action);
      action.stop();
    } else {
      this.#playingActions.delete(action);
      action.fadeOut(GAIT_FADE);
    }
  }

  /** Variations are stored by their index, and some models start past 0 (stand as only 1 and 2) */
  #firstVariation(id: number) {
    return this.#animator.sequences.get(id)?.find((variation) => variation !== undefined);
  }

  #startGait(gait: Gait) {
    const sequence = this.#firstVariation(GAIT_SEQUENCE[gait]);
    if (!sequence) return undefined;
    const action = this.#animator.getSequence(this, sequence.id, sequence.variationIndex);
    this.#gaitActions[gait] = action;
    this.#actions.add(action);
    return action;
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
      const sequence = this.#firstVariation(0);

      if (sequence && sequence.flags & 0x20) {
        const action = this.#animator.getSequence(this, sequence.id, sequence.variationIndex);
        action.play();

        this.#gaitActions.stand = action;
        this.#actions.add(action);
        this.#playingActions.add(action);
      }
    }
  }
}

export default ModelAnimation;

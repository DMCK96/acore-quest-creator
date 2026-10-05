// @ts-nocheck
import * as THREE from 'three';
import ModelBone from './ModelBone.js';
import { updateBone } from './skeleton.js';

class ModelSkeleton {
  #root: THREE.Object3D;
  #bones: ModelBone[];
  #boneTexture: THREE.DataTexture;
  #boneMatrices: Float32Array;

  /** The model-view matrix the bones were last worked out from (they are in the camera's space) */
  #poseView = new THREE.Matrix4();
  #poseViewInverse = new THREE.Matrix4();
  /**
   * Takes the last pose from the camera it was made for to the camera now: identity right after a
   * pose, and (view now) x (view then)^-1 on a frame the model is not posed. The shader applies it.
   */
  viewCorrection = new THREE.Matrix4();

  constructor(root: THREE.Object3D, bones: ModelBone[] = []) {
    this.#root = root;
    this.#bones = bones;

    this.#createBoneData();
  }

  get bones() {
    return this.#bones;
  }

  get boneTexture() {
    return this.#boneTexture;
  }

  dispose() {
    if (this.#boneTexture) {
      this.#boneTexture.dispose();
    }
  }

  /**
   * Calculate current bone matrices for all bones in skeleton. Each bone matrix is composed of
   * the current bone translation, rotation, and scale, and is adjusted to reflect parent
   * transformations within the bone hierarchy. Note that bone translation, rotation, and scale may
   * be animated.
   *
   * Depending on bone flags, certain bone matrices may be modified to reflect spherical or
   * cylindrical billboarding. Billboarding ensures vertices attached to the bone match the camera
   * view, and is often used in lighting effects (eg. a quad with a yellow circle texture may be
   * spherically billboarded to give the illusion of an orb of light).
   */
  update() {
    for (const [index, bone] of this.#bones.entries()) {
      // Calculate bone matrix
      updateBone(this.#root, bone);

      // Copy bone matrix into the skeleton's bone texture
      bone.matrix.toArray(this.#boneMatrices, index * 16);
    }

    this.#boneTexture.needsUpdate = true;

    this.#poseView.copy(this.#root.modelViewMatrix);
    this.#poseViewInverse.copy(this.#poseView).invert();
    this.viewCorrection.identity();
  }

  /** Carries the last pose to the model-view matrix now, for a frame the bones are not worked out */
  correct(modelView: THREE.Matrix4) {
    this.viewCorrection.multiplyMatrices(modelView, this.#poseViewInverse);
  }

  /**
   * From Skeleton#computeBoneTexture in Three.js. Creates bone matrices array and bone texture.
   *
   * @private
   */
  #createBoneData() {
    let size = Math.sqrt(this.#bones.length * 4);
    size = Math.ceil(size / 4) * 4;
    size = Math.max(size, 4);

    this.#boneMatrices = new Float32Array(size * size * 4);

    const boneTexture = new THREE.DataTexture(
      this.#boneMatrices,
      size,
      size,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    boneTexture.needsUpdate = true;
    this.#boneTexture = boneTexture;
  }
}

export default ModelSkeleton;

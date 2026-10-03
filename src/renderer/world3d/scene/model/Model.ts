// @ts-nocheck
import * as THREE from 'three';
import ModelMaterial from './ModelMaterial.js';
import ModelAnimator from './ModelAnimator.js';
import ModelAnimation from './ModelAnimation.js';
import { getSizeCategory } from '../world.js';

class Model extends THREE.Mesh {
  animation: ModelAnimation;

  diffuseColor: THREE.Color;
  emissiveColor: THREE.Color;
  alpha = 1.0;

  #skinned: boolean;

  #boundingSphereWorld = new THREE.Sphere();

  #size = 0.0;
  #sizeCategory = 0;

  constructor(
    geometry: THREE.BufferGeometry,
    materials: ModelMaterial[],
    animator: ModelAnimator,
    skinned: boolean,
  ) {
    super(geometry, materials);

    // Model culling is handled by scene managers
    this.frustumCulled = false;

    this.#skinned = skinned;

    // Every model instance gets a unique animation state managed by a single animator
    this.animation = animator.createAnimation(this);

    // If skinned, make skeleton available to materials for bone texture uploads
    if (this.#skinned) {
      for (const material of materials) {
        material.skeleton = this.animation.skeleton;
      }
    }

    this.diffuseColor = new THREE.Color(1.0, 1.0, 1.0);
    this.emissiveColor = new THREE.Color(0.0, 0.0, 0.0);
    this.alpha = 1.0;
  }

  get boundingBox() {
    return this.geometry.boundingBox;
  }

  get boundingSphere() {
    return this.geometry.boundingSphere;
  }

  get boundingSphereWorld() {
    return this.#boundingSphereWorld;
  }

  get size() {
    return this.#size;
  }

  get sizeCategory() {
    return this.#sizeCategory;
  }

  get skinned() {
    return this.#skinned;
  }

  hide() {
    if (!this.visible) {
      return;
    }

    this.visible = false;
    this.animation.suspend();
  }

  dispose() {
    this.animation.dispose();
  }

  show() {
    if (this.visible) {
      return;
    }

    this.visible = true;
    this.animation.resume();
  }

  updateMatrixWorld(force?: boolean) {
    super.updateMatrixWorld(force);

    this.#updateBounds();
    this.#updateSize();
  }

  updateSkeleton(camera: THREE.Camera) {
    // Calculate current model view matrix. This calculation is also performed by the Three.js
    // renderer, but since model skeleton calculations need a current model view matrix and run
    // before the render call, we can't rely on the model view matrix update in the renderer.
    this.modelViewMatrix.multiplyMatrices(camera.matrixWorldInverse, this.matrixWorld);

    // Calculate bone matrices
    this.animation.skeleton.update();
  }

  #updateBounds() {
    this.#boundingSphereWorld.copy(this.boundingSphere).applyMatrix4(this.matrixWorld);
  }

  #updateSize() {
    const sizeX = (this.boundingBox.max.x - this.boundingBox.min.x) * this.scale.x;
    const sizeY = (this.boundingBox.max.y - this.boundingBox.min.y) * this.scale.y;
    const sizeZ = (this.boundingBox.max.z - this.boundingBox.min.z) * this.scale.z;

    this.#size = Math.max(sizeX, sizeY, sizeZ);
    this.#sizeCategory = getSizeCategory(this.#size);
  }

  onBeforeRender(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    geometry: THREE.BufferGeometry,
    material: ModelMaterial,
    group: THREE.Group,
  ) {
    // Update material uniforms to match animation states
    material.prepareMaterial(this);
  }
}

export default Model;
export { Model };

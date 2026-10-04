// @ts-nocheck
import * as THREE from 'three';

class ModelBone {
  flags: number;
  parent: ModelBone | null;
  pivot: THREE.Vector3;

  translation = new THREE.Vector3();
  rotation = new THREE.Quaternion();
  scale = new THREE.Vector3(1.0, 1.0, 1.0);
  matrix = new THREE.Matrix4();

  constructor(flags: number, parent: ModelBone | null, pivot: THREE.Vector3) {
    this.flags = flags;
    this.parent = parent;
    this.pivot = pivot;
  }
}

export default ModelBone;

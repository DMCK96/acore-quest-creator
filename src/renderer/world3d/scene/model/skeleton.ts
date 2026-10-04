// @ts-nocheck
import * as THREE from 'three';
import { M2_BONE_FLAG } from '@wowserhq/format';
import ModelBone from './ModelBone.js';

const _boneTranslation = new THREE.Vector3();
const _boneMatrix = new THREE.Matrix4();
const _billboard = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _transformedPivot = new THREE.Vector4();
const _billboardPivot = new THREE.Vector4();

const translateMatrix = (matrix: THREE.Matrix4, translation: THREE.Vector3, scalar = 1) => {
  const x = translation.x * scalar;
  const y = translation.y * scalar;
  const z = translation.z * scalar;

  matrix.elements[12] =
    matrix.elements[0] * x + matrix.elements[4] * y + matrix.elements[8] * z + matrix.elements[12];

  matrix.elements[13] =
    matrix.elements[1] * x + matrix.elements[5] * y + matrix.elements[9] * z + matrix.elements[13];

  matrix.elements[14] =
    matrix.elements[2] * x + matrix.elements[6] * y + matrix.elements[10] * z + matrix.elements[14];
};

const applySphericalBillboard = (bone: ModelBone) => {
  if (bone.flags & (0x80 | 0x200)) {
    // X axis

    _billboard.set(_boneMatrix.elements[1], _boneMatrix.elements[2], -_boneMatrix.elements[0]);
    _billboard.normalize();

    bone.matrix.elements[0] = _billboard.x;
    bone.matrix.elements[1] = _billboard.y;
    bone.matrix.elements[2] = _billboard.z;

    // Y axis

    _billboard.set(_boneMatrix.elements[5], _boneMatrix.elements[6], -_boneMatrix.elements[4]);
    _billboard.normalize();

    bone.matrix.elements[4] = _billboard.x;
    bone.matrix.elements[5] = _billboard.y;
    bone.matrix.elements[6] = _billboard.z;

    // Z axis

    _billboard.set(_boneMatrix.elements[9], _boneMatrix.elements[10], -_boneMatrix.elements[8]);
    _billboard.normalize();

    bone.matrix.elements[8] = _billboard.x;
    bone.matrix.elements[9] = _billboard.y;
    bone.matrix.elements[10] = _billboard.z;
  } else {
    // X axis

    bone.matrix.elements[0] = 0.0;
    bone.matrix.elements[1] = 0.0;
    bone.matrix.elements[2] = -1.0;

    // Y axis

    bone.matrix.elements[4] = 1.0;
    bone.matrix.elements[5] = 0.0;
    bone.matrix.elements[6] = 0.0;

    // Z axis

    bone.matrix.elements[8] = 0.0;
    bone.matrix.elements[9] = 1.0;
    bone.matrix.elements[10] = 0.0;
  }
};

const billboardBone = (bone: ModelBone) => {
  // Save scale
  _scale.setFromMatrixScale(bone.matrix);

  _transformedPivot.set(bone.pivot.x, bone.pivot.y, bone.pivot.z, 1.0).applyMatrix4(bone.matrix);

  // Spherical billboard
  if (bone.flags & M2_BONE_FLAG.FLAG_SPHERICAL_BILLBOARD) {
    applySphericalBillboard(bone);
  } else if (bone.flags & M2_BONE_FLAG.FLAG_CYLINDRICAL_BILLBOARD_X) {
    // TODO
  } else if (bone.flags & M2_BONE_FLAG.FLAG_CYLINDRICAL_BILLBOARD_Y) {
    // TODO
  } else if (bone.flags & M2_BONE_FLAG.FLAG_CYLINDRICAL_BILLBOARD_Z) {
    // TODO
  }

  // Restore scale
  bone.matrix.scale(_scale);

  _billboardPivot.set(bone.pivot.x, bone.pivot.y, bone.pivot.z, 0.0).applyMatrix4(bone.matrix);

  bone.matrix.elements[12] = _transformedPivot.x - _billboardPivot.x;
  bone.matrix.elements[13] = _transformedPivot.y - _billboardPivot.y;
  bone.matrix.elements[14] = _transformedPivot.z - _billboardPivot.z;

  bone.matrix[3] = 0.0;
  bone.matrix[7] = 0.0;
  bone.matrix[11] = 0.0;
  bone.matrix[15] = 1.0;
};

const updateBone = (root: THREE.Object3D, bone: ModelBone) => {
  const parentMatrix = bone.parent ? bone.parent.matrix : root.modelViewMatrix;

  if (bone.flags & (0x80 | 0x200)) {
    _boneTranslation.copy(bone.translation).add(bone.pivot);
    _boneMatrix.compose(_boneTranslation, bone.rotation, bone.scale);
    translateMatrix(_boneMatrix, bone.pivot, -1);

    bone.matrix.multiplyMatrices(parentMatrix, _boneMatrix);
  } else {
    bone.matrix.copy(parentMatrix);
  }

  if (bone.flags & M2_BONE_FLAG.FLAG_BILLBOARD) {
    billboardBone(bone);
  }
};

export { updateBone };

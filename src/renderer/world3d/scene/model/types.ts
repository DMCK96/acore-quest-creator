// @ts-nocheck
import * as THREE from 'three';

type ModelMaterialColor = {
  color: THREE.Color;
  alpha: number;
};

type ModelTextureTransform = {
  translation: THREE.Vector3;
  rotation: THREE.Quaternion;
  scaling: THREE.Vector3;
};

export { ModelMaterialColor, ModelTextureTransform };

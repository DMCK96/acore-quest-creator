// @ts-nocheck
import * as THREE from 'three';

const getTrackInterpolation = (trackType: number): THREE.InterpolationModes => {
  switch (trackType) {
    case 0:
      return THREE.InterpolateDiscrete;
    case 1:
      return THREE.InterpolateLinear;
    case 2:
    case 3:
      // TODO 2 - cubic bezier, 3 - cubic hermite
      return THREE.InterpolateSmooth;
    default:
      return THREE.InterpolateLinear;
  }
};

export { getTrackInterpolation };

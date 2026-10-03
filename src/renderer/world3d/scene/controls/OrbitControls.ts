// @ts-nocheck
import * as THREE from 'three';
import BaseOrbitControls from './BaseOrbitControls.js';

class OrbitControls extends BaseOrbitControls {
  constructor(camera: THREE.PerspectiveCamera | THREE.OrthographicCamera, domElement: HTMLElement) {
    super(camera, domElement);

    this.update();
  }
}

export default OrbitControls;
export { OrbitControls };

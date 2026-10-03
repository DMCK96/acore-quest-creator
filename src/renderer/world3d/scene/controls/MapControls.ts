// @ts-nocheck
import * as THREE from 'three';
import BaseOrbitControls from './BaseOrbitControls.js';

const TARGET_OFFSET = 30.0;

class MapControls extends BaseOrbitControls {
  #raycaster = new THREE.Raycaster();
  #rayCoords = new THREE.Vector2();
  #cameraOffset = new THREE.Vector3(-TARGET_OFFSET, -TARGET_OFFSET, TARGET_OFFSET);

  constructor(camera: THREE.OrthographicCamera | THREE.PerspectiveCamera, domElement: HTMLElement) {
    super(camera, domElement);

    this.screenSpacePanning = false;

    // Since these controls orbit around a target that's perpetually centered in front of the
    // camera, assign appropriate distance values to permit the zoom logic in BaseOrbitControl
    // to endlessly chase the target.
    this.minDistance = TARGET_OFFSET / 2;
    this.maxDistance = TARGET_OFFSET * 2;

    this.mouseButtons = {
      LEFT: THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    };

    this.update();
  }

  /**
   * Given a desired target position and optional camera offset, reposition the camera at the
   * target position and camera offset, and adjust the camera to look at the target. If no camera
   * offset is provided, use the currently configured default camera offset for the controls.
   *
   * @param target
   * @param cameraOffset
   */
  setView(target: THREE.Vector3, cameraOffset?: THREE.Vector3) {
    this.target.copy(target);
    this.camera.position.copy(this.target);

    if (cameraOffset) {
      this.camera.position.add(cameraOffset);
    } else {
      this.camera.position.add(this.#cameraOffset);
    }

    this.camera.lookAt(this.target);

    this.update();
  }

  update(deltaTime?: number): boolean {
    this.#raycaster.setFromCamera(this.#rayCoords, this.camera);
    this.#raycaster.ray.at(TARGET_OFFSET, this.target);

    return super.update(deltaTime);
  }
}

export default MapControls;
export { MapControls };

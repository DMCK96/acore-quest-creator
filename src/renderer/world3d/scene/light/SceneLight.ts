// @ts-nocheck
import * as THREE from 'three';
import SceneLightParams from './SceneLightParams.js';

class SceneLight {
  #location: 'exterior' | 'interior' = 'exterior';

  #params = {
    exterior: new SceneLightParams(),
    interior: new SceneLightParams(),
  };

  #uniforms = {
    exterior: this.#params.exterior.uniforms,
    interior: this.#params.interior.uniforms,
  };

  get location() {
    return this.#location;
  }

  set location(location: 'exterior' | 'interior') {
    this.#location = location;
  }

  get uniforms() {
    return this.#uniforms[this.#location];
  }

  get sunDir() {
    return this.#params[this.#location].sunDir;
  }

  get sunDirView() {
    return this.#params[this.#location].sunDirView;
  }

  get sunDiffuseColor() {
    return this.#params[this.#location].sunDiffuseColor;
  }

  get sunAmbientColor() {
    return this.#params[this.#location].sunAmbientColor;
  }

  get fogParams() {
    return this.#params[this.#location].fogParams;
  }

  get fogStart() {
    return this.fogEnd - 1.0 / this.#params[this.#location].fogParams.x;
  }

  get fogEnd() {
    return this.#params[this.#location].fogParams.y;
  }

  get fogColor() {
    return this.#params[this.#location].fogColor;
  }

  update(camera: THREE.Camera) {
    const viewMatrix = camera.matrixWorldInverse;

    this.#params.exterior.transformSunDirView(viewMatrix);
    this.#params.interior.transformSunDirView(viewMatrix);
  }
}

export default SceneLight;
export { SceneLight };

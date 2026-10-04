// @ts-nocheck
import * as THREE from 'three';
import TextureManager from './TextureManager.js';

class ManagedDataTexture extends THREE.DataTexture {
  #manager: TextureManager;
  #refId: string;

  constructor(
    manager: TextureManager,
    refId: string,
    data?: BufferSource | null,
    width?: number,
    height?: number,
    format?: THREE.PixelFormat,
    type?: THREE.TextureDataType,
    mapping?: THREE.Mapping,
    wrapS?: THREE.Wrapping,
    wrapT?: THREE.Wrapping,
    magFilter?: THREE.MagnificationTextureFilter,
    minFilter?: THREE.MinificationTextureFilter,
    anisotropy?: number,
    colorSpace?: THREE.ColorSpace,
  ) {
    super(
      data,
      width,
      height,
      format,
      type,
      mapping,
      wrapS,
      wrapT,
      magFilter,
      minFilter,
      anisotropy,
      colorSpace,
    );

    this.#manager = manager;
    this.#refId = refId;
  }

  dispose() {
    if (this.#manager.deref(this.#refId) === 0) {
      super.dispose();
    }
  }
}

export default ManagedDataTexture;
export { ManagedDataTexture };

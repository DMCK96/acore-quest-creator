// @ts-nocheck
import * as THREE from 'three';
import TextureManager from './TextureManager.js';

class ManagedCompressedTexture extends THREE.CompressedTexture {
  #manager: TextureManager;
  #refId: string;

  constructor(
    manager: TextureManager,
    refId: string,
    mipmaps: ImageData[],
    width: number,
    height: number,
    format: THREE.CompressedPixelFormat,
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
      mipmaps,
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

export default ManagedCompressedTexture;
export { ManagedCompressedTexture };

// @ts-nocheck
import * as THREE from 'three';
import { BLP_IMAGE_FORMAT } from '@wowserhq/format';
import ManagedCompressedTexture from './ManagedCompressedTexture.js';
import ManagedDataTexture from './ManagedDataTexture.js';
import TextureLoader from './loader/TextureLoader.js';
import { AssetHost, normalizePath } from '../asset.js';
import { TextureSpec } from './loader/types.js';

const THREE_TEXTURE_FORMAT: Record<number, THREE.PixelFormat | THREE.CompressedPixelFormat> = {
  [BLP_IMAGE_FORMAT.IMAGE_DXT1]: THREE.RGBA_S3TC_DXT1_Format,
  [BLP_IMAGE_FORMAT.IMAGE_DXT3]: THREE.RGBA_S3TC_DXT3_Format,
  [BLP_IMAGE_FORMAT.IMAGE_DXT5]: THREE.RGBA_S3TC_DXT5_Format,
  [BLP_IMAGE_FORMAT.IMAGE_ABGR8888]: THREE.RGBAFormat,
};

type TextureManagerOptions = {
  host: AssetHost;
};

class TextureManager {
  #host: AssetHost;
  #loader: TextureLoader;

  #loaded = new Map<string, THREE.Texture>();
  #loading = new Map<string, Promise<THREE.Texture>>();
  #refs = new Map<string, number>();

  constructor(options: TextureManagerOptions) {
    this.#host = options.host;
    this.#loader = new TextureLoader({ host: options.host });
  }

  get(
    path: string,
    wrapS: THREE.Wrapping = THREE.RepeatWrapping,
    wrapT: THREE.Wrapping = THREE.RepeatWrapping,
    minFilter: THREE.MinificationTextureFilter = THREE.LinearMipmapLinearFilter,
    magFilter: THREE.MagnificationTextureFilter = THREE.LinearFilter,
  ) {
    const refId = [normalizePath(path), wrapS, wrapT, minFilter, magFilter].join(':');
    this.#ref(refId);

    const loaded = this.#loaded.get(refId);
    if (loaded) {
      return Promise.resolve(loaded);
    }

    const alreadyLoading = this.#loading.get(refId);
    if (alreadyLoading) {
      return alreadyLoading;
    }

    const loading = this.#load(refId, path, wrapS, wrapT, minFilter, magFilter);
    this.#loading.set(refId, loading);

    return loading;
  }

  deref(refId: string) {
    let refCount = this.#refs.get(refId);

    // Unknown ref

    if (refCount === undefined) {
      return;
    }

    // Decrement

    refCount--;

    if (refCount > 0) {
      this.#refs.set(refId, refCount);
      return refCount;
    }

    // Dispose

    const texture = this.#loaded.get(refId);
    if (texture) {
      this.#loaded.delete(refId);
    }

    this.#refs.delete(refId);

    return 0;
  }

  #ref(refId: string) {
    let refCount = this.#refs.get(refId) || 0;

    refCount++;

    this.#refs.set(refId, refCount);
  }

  async #load(
    refId: string,
    path: string,
    wrapS: THREE.Wrapping,
    wrapT: THREE.Wrapping,
    minFilter: THREE.MinificationTextureFilter,
    magFilter: THREE.MagnificationTextureFilter,
  ) {
    let spec: TextureSpec;
    try {
      spec = await this.#loader.loadSpec(path);
    } catch (error) {
      this.#loading.delete(refId);
      throw error;
    }

    const specFormat = spec.format;

    const threeFormat = THREE_TEXTURE_FORMAT[specFormat];
    if (threeFormat === undefined) {
      this.#loading.delete(refId);
      throw new Error(`Unsupported texture format: ${specFormat}`);
    }

    let texture: ManagedCompressedTexture | ManagedDataTexture;
    if (
      specFormat === BLP_IMAGE_FORMAT.IMAGE_DXT1 ||
      specFormat === BLP_IMAGE_FORMAT.IMAGE_DXT3 ||
      specFormat === BLP_IMAGE_FORMAT.IMAGE_DXT5
    ) {
      texture = new ManagedCompressedTexture(
        this,
        refId,
        null,
        spec.width,
        spec.height,
        threeFormat as THREE.CompressedPixelFormat,
      );
    } else if (specFormat === BLP_IMAGE_FORMAT.IMAGE_ABGR8888) {
      texture = new ManagedDataTexture(
        this,
        refId,
        null,
        spec.width,
        spec.height,
        threeFormat as THREE.PixelFormat,
      );
    }

    texture.mipmaps = spec.mipmaps;
    texture.wrapS = wrapS;
    texture.wrapT = wrapT;
    texture.minFilter = minFilter;
    texture.magFilter = magFilter;
    texture.anisotropy = 16;
    texture.name = normalizePath(path).split('/').at(-1);

    // All newly loaded textures need to be flagged for upload to the GPU
    texture.needsUpdate = true;

    this.#loaded.set(refId, texture);
    this.#loading.delete(refId);

    return texture;
  }
}

export default TextureManager;
export { TextureManager };

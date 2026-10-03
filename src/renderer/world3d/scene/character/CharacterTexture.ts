import * as THREE from 'three';
import { decodeBlp, type RgbaImage } from '../../../../core/client/blp';
import type { BodyTexture } from '../spawn/DisplayResolver';
import { composite } from './composite';

/**
 * Dressed NPCs' body textures, built as the game builds them: the skin, then each layer painted in
 * its region. Each one is made once for its layers and handed to the texture manager under a path of
 * its own, so a model asks for it like any other texture, and twenty guards in one uniform share it.
 */

/** Built textures are numbered across every world: the texture manager they are registered with is shared */
let built = 0;

type CharacterTextureOptions = {
  /** A client file's bytes, or null when the client does not have it */
  read(path: string): Promise<Uint8Array | null>;
  /** Hands a built texture to the texture manager under a path */
  register(path: string, texture: THREE.Texture): void;
};

export class CharacterTexture {
  readonly #read: CharacterTextureOptions['read'];
  readonly #register: CharacterTextureOptions['register'];
  readonly #built = new Map<string, Promise<string | null>>();
  readonly #warned = new Set<string>();

  constructor(options: CharacterTextureOptions) {
    this.#read = options.read;
    this.#register = options.register;
  }

  /** The path the body texture is registered under, built once per set of layers; null without its skin */
  build(body: BodyTexture): Promise<string | null> {
    const key = JSON.stringify([body.base, body.layers.map((l) => [l.files, l.region])]);
    let built = this.#built.get(key);
    if (!built) {
      built = this.#make(body);
      this.#built.set(key, built);
    }
    return built;
  }

  async #make(body: BodyTexture): Promise<string | null> {
    const base = await this.#image(body.base);
    if (!base) {
      this.#warnOnce(body.base, `3D view: texture ${body.base} for a dressed NPC could not be loaded; drawn in its bare skin`);
      return null;
    }

    const layers: { image: RgbaImage; region: BodyTexture['layers'][number]['region'] }[] = [];
    for (const layer of body.layers) {
      let image: RgbaImage | null = null;
      for (const file of layer.files) {
        image = await this.#image(file);
        if (image) break;
      }
      if (image) layers.push({ image, region: layer.region });
      else this.#warnOnce(layer.files.at(-1)!, `3D view: texture ${layer.files.at(-1)} for a dressed NPC could not be loaded; drawn without it`);
    }

    const out = composite(base, layers);
    const texture = new THREE.DataTexture(new Uint8Array(out.rgba), out.width, out.height, THREE.RGBAFormat);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.flipY = false;
    texture.needsUpdate = true;

    built += 1;
    const path = `composed\\${built}.blp`;
    this.#register(path, texture);
    return path;
  }

  /** A file decoded, or null when it cannot be read or is not a texture this can decode */
  async #image(path: string): Promise<RgbaImage | null> {
    try {
      const bytes = await this.#read(path);
      return bytes ? decodeBlp(bytes) : null;
    } catch {
      return null;
    }
  }

  #warnOnce(key: string, message: string) {
    if (!this.#warned.has(key)) {
      this.#warned.add(key);
      console.warn(message);
    }
  }
}

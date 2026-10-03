// @ts-nocheck
/**
 * The surface of one liquid type: its flipbook of textures, its tint and see-through-ness from the
 * light database, and whether it is lit (water) or glows (magma, slime).
 *
 * Adapted from Adrinalin4ik/world-of-warcraft's `pipeline/liquid/material/index.ts` (MIT, see LICENSE
 * here): the flipbook advanced by elapsed time rather than per frame, river or ocean tint taken from
 * the light bands rather than LiquidType.dbc's colours (zero in 3.3.5a), magma and slime unlit. The
 * colour and see-through law follows Kruithne/wow.export's mpv_liquid shader (MIT). Both are listed
 * in CREDITS.md at the repository root.
 */
import * as THREE from 'three';
import vertexShader from './shader/vertex.js';
import fragmentShader from './shader/fragment.js';

/** Flipbook frames a second: a 30-frame set cycles once a second */
const FRAMES_PER_SECOND = 30;

/** Frames the client's flipbooks can have; the real count is found by loading until one is missing */
const MAX_FRAMES = 64;

/** LiquidType.dbc's sound bank, which also decides how the surface is drawn */
const LIQUID_KIND = {
  WATER: 0,
  OCEAN: 1,
  MAGMA: 2,
  SLIME: 3,
} as const;

/** LiquidMaterial.dbc 2: magma and slime, whose texture flows over coordinates of its own */
const FLOWING_MATERIAL = 2;

type LiquidTypeInfo = {
  kind: number;
  materialId: number;
  /** The flipbook's path, with %d for the frame number (from 1); or a single texture */
  texturePattern: string;
  floats: number[];
};

class LiquidMaterial extends THREE.RawShaderMaterial {
  #frames: THREE.Texture[] = [];
  #time = 0;
  #disposed = false;

  constructor(
    info: LiquidTypeInfo,
    loadFrame: (path: string) => Promise<THREE.Texture | null>,
    uniforms: Record<string, THREE.IUniform>,
    placeholder: THREE.Texture,
  ) {
    super();

    const flows = info.materialId === FLOWING_MATERIAL;
    const [first = 0, second = 0] = info.floats ?? [];

    this.uniforms = {
      ...uniforms,
      frame: { value: placeholder },
      kind: { value: info.kind },
      flows: { value: flows },
      // Water: scale (none is no scaling) and rotation in degrees; magma and slime: flow speed
      uvParams: { value: new THREE.Vector2(flows ? first : first || 1, second) },
      time: { value: 0 },
    };

    this.vertexShader = vertexShader;
    this.fragmentShader = fragmentShader;
    this.glslVersion = THREE.GLSL3;
    // Seen from below too, when the camera is under water
    this.side = THREE.DoubleSide;

    const solid = info.kind === LIQUID_KIND.MAGMA || info.kind === LIQUID_KIND.SLIME;
    this.transparent = !solid;
    // See-through water must not hide what is under it from later draws, or itself where it overlaps
    this.depthWrite = solid;

    this.#loadFrames(info.texturePattern, loadFrame).catch((error) => console.error(error));
  }

  /** Advances the flipbook and the flow; `deltaTime` in seconds */
  update(deltaTime: number) {
    this.#time += deltaTime || 0;
    this.uniforms.time.value = this.#time;

    if (this.#frames.length > 0) {
      const index = Math.floor(this.#time * FRAMES_PER_SECOND) % this.#frames.length;
      this.uniforms.frame.value = this.#frames[index];
    }
  }

  dispose() {
    this.#disposed = true;
    for (const frame of this.#frames) {
      frame.dispose();
    }
    this.#frames = [];
    super.dispose();
  }

  /**
   * Frame by frame, each as it arrives, stopping at the first that is missing: sets differ in length
   * (fast water has 16 frames, most have 30), and asking for frames that do not exist would log them
   */
  async #loadFrames(pattern: string, loadFrame: (path: string) => Promise<THREE.Texture | null>) {
    if (!pattern) {
      return;
    }

    if (!pattern.includes('%d')) {
      const texture = await loadFrame(pattern);
      if (texture && !this.#disposed) {
        this.#frames.push(texture);
      }
      return;
    }

    for (let frame = 1; frame <= MAX_FRAMES && !this.#disposed; frame++) {
      const texture = await loadFrame(pattern.replace('%d', String(frame)));
      if (!texture) {
        if (frame === 1) {
          console.warn(`3D view: liquid texture ${pattern.replace('%d', '1')} could not be loaded`);
        }
        return;
      }
      if (this.#disposed) {
        texture.dispose();
        return;
      }
      this.#frames.push(texture);
    }
  }
}

export default LiquidMaterial;
export { LIQUID_KIND, LiquidMaterial, LiquidTypeInfo };

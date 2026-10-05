import * as THREE from 'three';
import { M2_MATERIAL_BLEND } from '@wowserhq/format';
import type Model from '../model/Model.js';
import type ModelMaterial from '../model/ModelMaterial.js';

/**
 * Every shown copy of one doodad that never moves its bones (a fence, a crate, a lamp post), drawn
 * in one call per material instead of one per copy. Its materials are a template model's, which is
 * never in the scene: its animation still runs, so a texture that scrolls or a colour that pulses
 * moves on every copy together. Only copies drawn fully (not fading out) and with no blended
 * material are put in a batch: blended ones would need sorting, copy by copy.
 */
class DoodadBatch extends THREE.InstancedMesh {
  readonly template: Model;

  constructor(template: Model) {
    // The template's vertices, index and material groups, shared, not copied. Never disposed: that
    // would make three.js delete the vertex buffers the doodads themselves draw from
    const geometry = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(template.geometry.attributes)) {
      geometry.setAttribute(name, attribute);
    }
    geometry.setIndex(template.geometry.index);
    for (const group of template.geometry.groups) {
      geometry.addGroup(group.start, group.count, group.materialIndex);
    }

    const materials = template.material as ModelMaterial[];
    for (const material of materials) {
      material.defines['USE_INSTANCING'] = 1;
      material.needsUpdate = true;
    }

    super(geometry, materials, 0);
    this.name = 'doodad-batch';
    // Culled copy by copy before they are put in
    this.frustumCulled = false;
    this.matrixAutoUpdate = false;
    this.template = template;
  }

  /**
   * Whether a doodad can be drawn in a batch: its bones never move, and nothing of it is blended.
   * Asked of how the model file blends, not of `transparent`, which is also on while a copy fades in;
   * alpha-keyed parts (cut-out leaves and fences) are drawn unsorted, so they batch.
   */
  static fits(model: Model): boolean {
    return !model.skinned && (model.material as ModelMaterial[]).every((material) => material.blend <= M2_MATERIAL_BLEND.BLEND_ALPHA_KEY);
  }

  /** Starts a cull's worth of copies */
  begin() {
    this.count = 0;
  }

  /** One more copy, where the doodad stands */
  addCopy(model: Model) {
    if (this.count === this.instanceMatrix.count) {
      this.#grow(Math.max(16, this.count * 2));
    }
    this.setMatrixAt(this.count, model.matrixWorld);
    this.count += 1;
  }

  /** The copies are all in: sends them to the GPU */
  finish() {
    this.instanceMatrix.needsUpdate = true;
    this.visible = this.count > 0;
  }

  /** Room for more copies; the old buffer is let go */
  #grow(capacity: number) {
    const array = new Float32Array(capacity * 16);
    array.set(this.instanceMatrix.array.subarray(0, this.count * 16));
    // Tells three.js to free the buffer of the old attribute
    this.dispatchEvent({ type: 'dispose' });
    this.instanceMatrix = new THREE.InstancedBufferAttribute(array, 16);
    this.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }

  onBeforeRender(
    _renderer: THREE.WebGLRenderer,
    _scene: THREE.Scene,
    _camera: THREE.Camera,
    _geometry: THREE.BufferGeometry,
    material: THREE.Material,
  ) {
    // The template's animation state, as each copy would have had it
    (material as ModelMaterial).prepareMaterial(this.template);
  }
}

export default DoodadBatch;

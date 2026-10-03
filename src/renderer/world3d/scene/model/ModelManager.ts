// @ts-nocheck
import * as THREE from 'three';
import { M2_TEXTURE_COMPONENT, M2_TEXTURE_FLAG } from '@wowserhq/format';
import TextureManager from '../texture/TextureManager.js';
import { AssetHost, normalizePath } from '../asset.js';
import Model from './Model.js';
import ModelMaterial from './ModelMaterial.js';
import { getVertexShader } from './shader/vertex.js';
import { getFragmentShader } from './shader/fragment.js';
import ModelLoader from './loader/ModelLoader.js';
import { MaterialSpec, ModelSpec, TextureSpec } from './loader/types.js';
import SceneLight from '../light/SceneLight.js';
import ModelAnimator from './ModelAnimator.js';
import { groupVisible, lookKey, ModelLookInput, texturePathFor } from './look.js';

type ModelResources = {
  path: string;
  name: string;
  geometry: THREE.BufferGeometry;
  /** The geometry with only some geosets drawn, one per choice of geosets */
  lookGeometries: globalThis.Map<string, THREE.BufferGeometry>;
  groups: { start: number; count: number; materialIndex: number; geosetId: number }[];
  materials: MaterialSpec[];
  animator: ModelAnimator;
  skinned: boolean;
  attachments: { id: number; bone: number; position: [number, number, number] }[];
};

type ModelManagerOptions = {
  host: AssetHost;
  textureManager?: TextureManager;
  sceneLight?: SceneLight;
};

class ModelManager {
  #host: AssetHost;
  #textureManager: TextureManager;
  #sceneLight: SceneLight;

  #loader: ModelLoader;
  #loaded = new globalThis.Map<string, ModelResources>();
  #loading = new globalThis.Map<string, Promise<ModelResources>>();

  constructor(options: ModelManagerOptions) {
    this.#host = options.host;

    this.#textureManager = options.textureManager ?? new TextureManager({ host: options.host });
    this.#loader = new ModelLoader({ host: options.host });

    this.#sceneLight = options.sceneLight ?? new SceneLight();
  }

  /** A model, drawn in a look (its replaceable skins and the geosets that show) when one is given */
  async get(path: string, look?: ModelLookInput) {
    const resources = await this.#getResources(path);
    return this.#createModel(resources, look);
  }

  update(deltaTime: number, camera: THREE.Camera) {
    for (const resources of this.#loaded.values()) {
      if (resources.animator) {
        resources.animator.update(deltaTime, camera);
      }
    }
  }

  #getResources(path: string) {
    const refId = normalizePath(path);

    const loaded = this.#loaded.get(refId);
    if (loaded) {
      return Promise.resolve(loaded);
    }

    const alreadyLoading = this.#loading.get(refId);
    if (alreadyLoading) {
      return alreadyLoading;
    }

    const loading = this.#loadResources(refId, path);
    this.#loading.set(refId, loading);

    return loading;
  }

  async #loadResources(refId: string, path: string) {
    const spec = await this.#loader.loadSpec(path);

    const animator = this.#createAnimator(spec);
    const geometry = this.#createGeometry(spec);

    const resources: ModelResources = {
      path,
      name: spec.name,
      geometry,
      lookGeometries: new globalThis.Map(),
      groups: spec.geometry.groups,
      materials: spec.materials,
      animator,
      skinned: spec.skinned,
      attachments: spec.attachments ?? [],
    };

    this.#loaded.set(refId, resources);
    this.#loading.delete(refId);

    return resources;
  }

  #createGeometry(spec: ModelSpec) {
    const vertexBuffer = spec.geometry.vertexBuffer;
    const indexBuffer = spec.geometry.indexBuffer;

    const geometry = new THREE.BufferGeometry();

    const positions = new THREE.InterleavedBuffer(new Float32Array(vertexBuffer), 48 / 4);
    geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(positions, 3, 0, false));

    const boneWeights = new THREE.InterleavedBuffer(new Uint8Array(vertexBuffer), 48);
    geometry.setAttribute(
      'skinWeight',
      new THREE.InterleavedBufferAttribute(boneWeights, 4, 12, true),
    );

    const boneIndices = new THREE.InterleavedBuffer(new Uint8Array(vertexBuffer), 48);
    geometry.setAttribute(
      'skinIndex',
      new THREE.InterleavedBufferAttribute(boneIndices, 4, 16, false),
    );

    const normals = new THREE.InterleavedBuffer(new Float32Array(vertexBuffer), 48 / 4);
    geometry.setAttribute(
      'normal',
      new THREE.InterleavedBufferAttribute(normals, 3, 20 / 4, false),
    );

    const texCoord1 = new THREE.InterleavedBuffer(new Float32Array(vertexBuffer), 48 / 4);
    geometry.setAttribute(
      'texCoord1',
      new THREE.InterleavedBufferAttribute(texCoord1, 2, 32 / 4, false),
    );

    const texCoord2 = new THREE.InterleavedBuffer(new Float32Array(vertexBuffer), 48 / 4);
    geometry.setAttribute(
      'texCoord2',
      new THREE.InterleavedBufferAttribute(texCoord2, 2, 40 / 4, false),
    );

    const index = new THREE.BufferAttribute(new Uint16Array(indexBuffer), 1, false);
    geometry.setIndex(index);

    for (const group of spec.geometry.groups) {
      geometry.addGroup(group.start, group.count, group.materialIndex);
    }

    // Bounds

    geometry.boundingBox = new THREE.Box3().setFromArray(spec.bounds.extent);

    const boundsCenter = new THREE.Vector3(
      spec.bounds.center[0],
      spec.bounds.center[1],
      spec.bounds.center[2],
    );
    geometry.boundingSphere = new THREE.Sphere(boundsCenter, spec.bounds.radius);

    return geometry;
  }

  #createMaterials(resources: ModelResources, look: ModelLookInput | undefined) {
    return Promise.all(
      resources.materials.map((materialSpec) =>
        this.#createMaterial(materialSpec, resources.skinned, resources.path, look),
      ),
    );
  }

  async #createMaterial(spec: MaterialSpec, skinned: boolean, modelName: string, look: ModelLookInput | undefined) {
    const vertexShader = getVertexShader(spec.vertexShader);
    const fragmentShader = getFragmentShader(spec.fragmentShader);
    const textures = await Promise.all(
      spec.textures.map((textureSpec) => this.#createTexture(textureSpec, modelName, look)),
    );
    const textureWeightIndex = spec.textureWeightIndex;
    const textureTransformIndices = spec.textureTransformIndices;
    const materialColorIndex = spec.materialColorIndex;
    const boneInfluences = spec.boneInfluences;
    const uniforms = { ...this.#sceneLight.uniforms };

    return new ModelMaterial(
      vertexShader,
      fragmentShader,
      textures,
      textureWeightIndex,
      textureTransformIndices,
      materialColorIndex,
      skinned,
      boneInfluences,
      uniforms,
      spec.blend,
      spec.flags,
    );
  }

  async #createTexture(spec: TextureSpec, modelName: string, look: ModelLookInput | undefined) {
    const wrapS =
      spec.flags & M2_TEXTURE_FLAG.FLAG_WRAP_S ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    const wrapT =
      spec.flags & M2_TEXTURE_FLAG.FLAG_WRAP_T ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;

    // A fixed texture as the model names it; a replaceable one (a skin) from the look, else blank
    const path = texturePathFor(spec, look);
    if (path) {
      return this.#textureManager.get(path, wrapS, wrapT, undefined, undefined, `model ${modelName}`);
    }

    return new THREE.Texture();
  }

  async #createModel(resources: ModelResources, look: ModelLookInput | undefined) {
    const { name, animator, skinned } = resources;
    const geometry = this.#geometryFor(resources, look);
    const materials = await this.#createMaterials(resources, look);

    const model = new Model(geometry, materials, animator, skinned);
    model.name = name;
    model.attachments = resources.attachments;

    return model;
  }

  /**
   * The model's geometry with only the look's geosets drawn: the same buffers, fewer draw groups. Made
   * once per choice of geosets; a look that names none draws the shared geometry as it is.
   */
  #geometryFor(resources: ModelResources, look: ModelLookInput | undefined) {
    if (!look?.geosets) {
      return resources.geometry;
    }

    const key = lookKey({ geosets: look.geosets });
    let geometry = resources.lookGeometries.get(key);
    if (!geometry) {
      const shared = resources.geometry;
      geometry = new THREE.BufferGeometry();
      for (const [name, attribute] of Object.entries(shared.attributes)) {
        geometry.setAttribute(name, attribute);
      }
      geometry.setIndex(shared.index);
      for (const group of resources.groups) {
        if (groupVisible(group.geosetId, look)) {
          geometry.addGroup(group.start, group.count, group.materialIndex);
        }
      }
      geometry.boundingBox = shared.boundingBox;
      geometry.boundingSphere = shared.boundingSphere;
      resources.lookGeometries.set(key, geometry);
    }
    return geometry;
  }

  #createAnimator(spec: ModelSpec) {
    if (spec.loops.length === 0 && spec.sequences.length === 0) {
      return null;
    }

    const animator = new ModelAnimator(spec.loops, spec.sequences, spec.skinned ? spec.bones : []);

    const hasTextureWeights =
      spec.textureWeights.length > 1 ||
      spec.textureWeights[0]?.weightTrack.sequenceKeys.length > 1 ||
      spec.textureWeights[0]?.weightTrack.sequenceKeys[0].length > 1 ||
      spec.textureWeights[0]?.weightTrack.sequenceKeys[0][0] !== 0x7fff;

    if (hasTextureWeights) {
      for (const [index, textureWeight] of spec.textureWeights.entries()) {
        animator.registerTrack(
          { state: 'textureWeights', index },
          textureWeight.weightTrack,
          THREE.NumberKeyframeTrack,
          (value: number) => value / 0x7fff,
        );
      }
    }

    for (const [index, textureTransform] of spec.textureTransforms.entries()) {
      animator.registerTrack(
        { state: 'textureTransforms', index, property: 'translation' },
        textureTransform.translationTrack,
        THREE.VectorKeyframeTrack,
      );

      animator.registerTrack(
        { state: 'textureTransforms', index, property: 'rotation ' },
        textureTransform.rotationTrack,
        THREE.QuaternionKeyframeTrack,
      );

      animator.registerTrack(
        { state: 'textureTransforms', index, property: 'scaling' },
        textureTransform.scalingTrack,
        THREE.VectorKeyframeTrack,
      );
    }

    for (const [index, materialColor] of spec.materialColors.entries()) {
      animator.registerTrack(
        { state: 'materialColors', index, property: 'color' },
        materialColor.colorTrack,
        THREE.ColorKeyframeTrack,
      );

      animator.registerTrack(
        { state: 'materialColors', index, property: 'alpha' },
        materialColor.alphaTrack,
        THREE.NumberKeyframeTrack,
        (value: number) => value / 0x7fff,
      );
    }

    for (const [index, bone] of spec.bones.entries()) {
      animator.registerTrack(
        { state: 'bones', index, property: 'translation' },
        bone.translationTrack,
        THREE.VectorKeyframeTrack,
      );

      animator.registerTrack(
        { state: 'bones', index, property: 'rotation' },
        bone.rotationTrack,
        THREE.QuaternionKeyframeTrack,
        (value: number) => (value > 0 ? value - 0x7fff : value + 0x7fff) / 0x7fff,
      );

      animator.registerTrack(
        { state: 'bones', index, property: 'scale' },
        bone.scaleTrack,
        THREE.VectorKeyframeTrack,
      );
    }

    return animator;
  }
}

export default ModelManager;
export { ModelManager };

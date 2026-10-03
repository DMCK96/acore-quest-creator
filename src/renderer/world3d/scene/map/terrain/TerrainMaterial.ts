// @ts-nocheck
import * as THREE from 'three';
import vertexShader from './shader/vertex.js';
import fragmentShader from './shader/fragment.js';

class TerrainMaterial extends THREE.RawShaderMaterial {
  constructor(
    layerCount: number,
    layerTextures: THREE.Texture[],
    splatTexture: THREE.Texture,
    uniforms: Record<string, THREE.IUniform>,
  ) {
    super();

    this.defines['LAYER_COUNT'] = layerCount;

    this.uniforms = {
      ...uniforms,
      layers: { value: layerTextures },
      splat: { value: splatTexture },
    };

    this.vertexShader = vertexShader;
    this.fragmentShader = fragmentShader;
    this.glslVersion = THREE.GLSL3;
    this.side = THREE.FrontSide;
    this.blending = 0;
  }

  dispose() {
    // Layer textures
    for (const texture of this.uniforms.layers.value) {
      texture.dispose();
    }

    // Splat texture
    this.uniforms.splat.value.dispose();

    super.dispose();
  }
}

export default TerrainMaterial;
export { TerrainMaterial };

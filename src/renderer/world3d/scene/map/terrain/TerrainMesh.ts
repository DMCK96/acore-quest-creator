// @ts-nocheck
import * as THREE from 'three';

class TerrainMesh extends THREE.Mesh {
  constructor(position: number[], geometry: THREE.BufferGeometry, material: THREE.Material) {
    super(geometry, material);

    this.position.set(position[0], position[1], position[2]);
    this.updateMatrixWorld();
  }

  dispose() {
    this.geometry.dispose();
    (this.material as THREE.Material).dispose();
  }
}

export default TerrainMesh;
export { TerrainMesh };

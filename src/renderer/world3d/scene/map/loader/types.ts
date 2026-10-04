// @ts-nocheck
import { LiquidSpec } from './liquid.js';

type MapSpec = {
  availableAreas: Uint8Array;
};

type MapDoodadDefSpec = {
  id: number;
  name: string;
  position: number[];
  rotation: number[];
  scale: number;
};

type MapObjDefSpec = {
  id: number;
  name: string;
  position: number[];
  rotation: number[];
};

type TerrainLayerSpec = {
  texturePath: string;
  effectId: number;
};

type TerrainSplatSpec = {
  data: Uint8Array;
  width: number;
  height: number;
  channels: number;
};

type TerrainMaterialSpec = {
  splat: TerrainSplatSpec;
  layers: TerrainLayerSpec[];
};

type TerrainGeometrySpec = {
  bounds: { extent: Float32Array; center: Float32Array; radius: number };
  vertexBuffer: ArrayBuffer;
  indexBuffer: ArrayBuffer;
};

type TerrainSpec = {
  position: number[];
  geometry: TerrainGeometrySpec;
  material: TerrainMaterialSpec;
};

type MapAreaSpec = {
  terrain: TerrainSpec[];
  liquids: LiquidSpec[];
  areaTableIds: Uint32Array;
  doodadDefs: MapDoodadDefSpec[];
  objDefs: MapObjDefSpec[];
};

export { LiquidSpec, MapSpec, MapAreaSpec, MapDoodadDefSpec, MapObjDefSpec, TerrainSpec };

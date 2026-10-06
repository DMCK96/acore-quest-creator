// @ts-nocheck
import { LiquidSpec } from './liquid.js';

type MapSpec = {
  availableAreas: Uint8Array;
};

type MapDoodadDefSpec = {
  /** The placement's unique id; a building's own doodad is its building's id and its index (`12345:7`) */
  id: number | string;
  name: string;
  position: number[];
  rotation: number[];
  /** Fixed precision: 1024 is full size */
  scale: number;
  /** The building whose furniture or prop it is, for one inside a building: shown and hidden with the buildings */
  building?: string;
};

type MapObjDefSpec = {
  id: number;
  name: string;
  position: number[];
  rotation: number[];
  /** Which of the building's doodad sets this placement shows beside its default set (0) */
  doodadSet: number;
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

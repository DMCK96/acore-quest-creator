import type { LiquidSpec } from '../../map/loader/liquid.js';

type WmoBatchSpec = {
  /** First index, and how many, in the group's index buffer */
  start: number;
  count: number;
  /** Which of the building's materials the batch is drawn with */
  material: number;
};

type WmoGroupSpec = {
  positions: Float32Array;
  normals: Float32Array | null;
  uvs: Float32Array | null;
  /** Baked lighting, red-green-blue-alpha; null when the group has none */
  colors: Uint8Array | null;
  /** 16-bit, or 32-bit for a mesh of more than 65,535 vertices */
  indices: Uint16Array | Uint32Array;
  batches: WmoBatchSpec[];
};

type WmoMaterialSpec = {
  flags: number;
  /** 0 opaque, 1 alpha key, 2 alpha blend, 3 additive */
  blend: number;
  /** Diffuse texture path first; absent for a plain material */
  textures: string[];
};

/** A building's furniture and props: its doodad sets, and the doodads they draw from, in its own space */
type WmoDoodadsSpec = {
  sets: { startIndex: number; count: number }[];
  defs: { name: string; position: number[]; rotation: number[]; scale: number }[];
};

type WmoSpec = {
  materials: WmoMaterialSpec[];
  /** The building's meshes: its groups, those near one another joined, each drawn once for each material it uses */
  groups: WmoGroupSpec[];
  /** Its groups' water, magma and slime, in the building's space */
  liquids: LiquidSpec[];
  /** What could not be read: a group file that is missing or broken */
  problems: string[];
  doodads: WmoDoodadsSpec;
};

export type { WmoBatchSpec, WmoDoodadsSpec, WmoGroupSpec, WmoMaterialSpec, WmoSpec };

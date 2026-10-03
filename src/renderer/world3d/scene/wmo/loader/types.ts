// @ts-nocheck
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
  indices: Uint16Array;
  batches: WmoBatchSpec[];
};

type WmoMaterialSpec = {
  flags: number;
  /** 0 opaque, 1 alpha key, 2 alpha blend, 3 additive */
  blend: number;
  /** Diffuse texture path first; absent for a plain material */
  textures: string[];
};

type WmoSpec = {
  materials: WmoMaterialSpec[];
  groups: WmoGroupSpec[];
  /** What could not be read: a group file that is missing or broken */
  problems: string[];
};

export { WmoBatchSpec, WmoGroupSpec, WmoMaterialSpec, WmoSpec };

// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  LIQUID_UNIT,
  LIQUID_VERTEX_STRIDE,
  UV_DATA_SCALE,
  UV_PER_UNIT,
  createLiquidSpecs,
  readLiquidInstances,
} from '../../src/renderer/world3d/scene/map/loader/liquid';

type Instance = {
  chunk: number;
  type: number;
  format: number;
  min: number;
  max: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Tile bits, low bit first; omitted for "all filled" */
  bitmap?: number[];
  heights?: number[];
  depths?: number[];
  /** Magma and slime's flow coordinates, two per vertex, after the heights */
  uvs?: number[];
};

/** An area file with MVER, MHDR and an MH2O holding these instances, one per chunk */
const areaFile = (instances: Instance[] | null): ArrayBuffer => {
  const header = new Uint8Array(20 + 64);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, 0x4d564552, true); // 'REVM'
  headerView.setUint32(4, 4, true);
  headerView.setUint32(8, 18, true);
  headerView.setUint32(12, 0x4d484452, true); // 'RDHM'
  headerView.setUint32(16, 64, true);
  if (!instances) return header.buffer;

  // MH2O data: 256 headers, then each instance (24 bytes) followed by its bitmap and vertex data
  const data = new DataView(new ArrayBuffer(64 * 1024));
  let end = 256 * 12;
  for (const inst of instances) {
    const at = end;
    end += 24;
    data.setUint32(inst.chunk * 12, at, true);
    data.setUint32(inst.chunk * 12 + 4, 1, true);
    data.setUint16(at, inst.type, true);
    data.setUint16(at + 2, inst.format, true);
    data.setFloat32(at + 4, inst.min, true);
    data.setFloat32(at + 8, inst.max, true);
    data.setUint8(at + 12, inst.x);
    data.setUint8(at + 13, inst.y);
    data.setUint8(at + 14, inst.w);
    data.setUint8(at + 15, inst.h);
    if (inst.bitmap) {
      data.setUint32(at + 16, end, true);
      inst.bitmap.forEach((byte, i) => data.setUint8(end + i, byte));
      end += 8;
    }
    if (inst.heights || inst.depths) {
      data.setUint32(at + 20, end, true);
      for (const height of inst.heights ?? []) {
        data.setFloat32(end, height, true);
        end += 4;
      }
      for (const uv of inst.uvs ?? []) {
        data.setUint16(end, uv, true);
        end += 2;
      }
      for (const depth of inst.depths ?? []) data.setUint8(end++, depth);
    }
  }

  const file = new Uint8Array(header.length + 8 + end);
  file.set(header);
  const view = new DataView(file.buffer);
  view.setUint32(20 + 40, 64, true); // mh2oOffset, from MHDR's data: right after it
  view.setUint32(84, 0x4d48324f, true); // 'O2HM'
  view.setUint32(88, end, true);
  file.set(new Uint8Array(data.buffer, 0, end), 92);
  return file.buffer;
};

const corners = Array.from({ length: 256 }, (_, i) => [1000 - Math.floor(i / 16) * LIQUID_UNIT * 8, 2000 - (i % 16) * LIQUID_UNIT * 8, 50]);

describe('reading an area file’s liquid', () => {
  it('finds none in an area without an MH2O chunk', () => {
    expect(readLiquidInstances(areaFile(null))).toEqual([]);
  });

  it('reads heights, depths and which tiles are filled for river water (heights and depths)', () => {
    const [instance] = readLiquidInstances(
      areaFile([{ chunk: 17, type: 5, format: 0, min: 10, max: 11, x: 2, y: 3, w: 2, h: 1, bitmap: [0b01], heights: [10, 10.5, 11, 10, 10.5, 11], depths: [0, 50, 100, 150, 200, 250] }]),
    );
    expect(instance).toMatchObject({ chunkIndex: 17, liquidType: 5, vertexFormat: 0, offsetX: 2, offsetY: 3, width: 2, height: 1 });
    expect(Array.from(instance!.exists)).toEqual([1, 0]);
    expect(Array.from(instance!.heights!)).toEqual([10, 10.5, 11, 10, 10.5, 11]);
    expect(Array.from(instance!.depths!)).toEqual([0, 50, 100, 150, 200, 250]);
  });

  it('reads ocean (depths only) with no heights, and no bitmap as every tile filled', () => {
    const [instance] = readLiquidInstances(areaFile([{ chunk: 0, type: 2, format: 2, min: 0, max: 0, x: 0, y: 0, w: 1, h: 1, depths: [9, 9, 9, 9] }]));
    expect(instance!.heights).toBeNull();
    expect(Array.from(instance!.depths!)).toEqual([9, 9, 9, 9]);
    expect(Array.from(instance!.exists)).toEqual([1]);
  });
});

describe('a liquid mesh', () => {
  it('starts at its chunk’s corner and runs rows along -X and columns along -Y, as the terrain does', () => {
    const instances = readLiquidInstances(
      areaFile([{ chunk: 17, type: 5, format: 0, min: 10, max: 11, x: 2, y: 3, w: 2, h: 1, heights: [10, 10.5, 11, 10, 10.5, 11], depths: [0, 0, 0, 255, 255, 255] }]),
    );
    const [spec] = createLiquidSpecs(instances, corners);
    const vertices = new Float32Array(spec!.vertexBuffer);
    const vertex = (i: number) => Array.from(vertices.subarray(i * LIQUID_VERTEX_STRIDE, i * LIQUID_VERTEX_STRIDE + LIQUID_VERTEX_STRIDE));

    expect(spec!.liquidType).toBe(5);
    expect(spec!.position).toEqual(corners[0]);
    // First vertex: chunk 17 (row 1, column 1), tile row 3 and column 2, measured from chunk 0's corner
    const [x, y, z, u, v, depth] = vertex(0);
    expect(x).toBeCloseTo(corners[17]![0]! - corners[0]![0]! - 3 * LIQUID_UNIT, 3);
    expect(y).toBeCloseTo(corners[17]![1]! - corners[0]![1]! - 2 * LIQUID_UNIT, 3);
    expect(z).toBeCloseTo(10 - 50, 5);
    // From where it is in the world, so the texture runs on across chunks and areas
    expect(u).toBeCloseTo((x! + corners[0]![0]!) * UV_PER_UNIT, 3);
    expect(v).toBeCloseTo((y! + corners[0]![1]!) * UV_PER_UNIT, 3);
    expect(depth).toBe(0);
    // Last vertex: one row and two columns further on, fully deep
    const last = vertex(5);
    expect(last[0]! - x!).toBeCloseTo(-LIQUID_UNIT, 3);
    expect(last[1]! - y!).toBeCloseTo(-2 * LIQUID_UNIT, 3);
    expect(last[5]).toBe(1);
  });

  it('has two triangles per filled tile and none for an empty one', () => {
    const instances = readLiquidInstances(areaFile([{ chunk: 0, type: 1, format: 2, min: 5, max: 5, x: 0, y: 0, w: 2, h: 2, bitmap: [0b1001], depths: Array(9).fill(0) }]));
    const [spec] = createLiquidSpecs(instances, corners);
    expect(new Uint16Array(spec!.indexBuffer)).toHaveLength(2 * 6);
  });

  it('puts ocean, which has no heights, at its surface level', () => {
    const instances = readLiquidInstances(areaFile([{ chunk: 0, type: 2, format: 2, min: -3, max: -3, x: 0, y: 0, w: 1, h: 1, depths: [0, 0, 0, 0] }]));
    const [spec] = createLiquidSpecs(instances, corners);
    expect(new Float32Array(spec!.vertexBuffer)[2]).toBeCloseTo(-3 - 50, 5);
  });

  it('takes magma’s texture coordinates (its flow) from the file', () => {
    const instances = readLiquidInstances(
      areaFile([{ chunk: 0, type: 3, format: 1, min: 0, max: 0, x: 0, y: 0, w: 1, h: 1, heights: [1, 1, 1, 1], uvs: [0, 0, 256, 0, 0, 512, 256, 512] }]),
    );
    expect(Array.from(instances[0]!.uvs!)).toEqual([0, 0, 256, 0, 0, 512, 256, 512]);
    const vertices = new Float32Array(createLiquidSpecs(instances, corners)[0]!.vertexBuffer);
    const uv = (i: number) => [vertices[i * LIQUID_VERTEX_STRIDE + 3], vertices[i * LIQUID_VERTEX_STRIDE + 4]];
    expect(uv(3)).toEqual([256 * UV_DATA_SCALE, 512 * UV_DATA_SCALE]);
  });

  it('is one mesh per liquid type in the area', () => {
    const instances = readLiquidInstances(
      areaFile([
        { chunk: 0, type: 2, format: 2, min: 0, max: 0, x: 0, y: 0, w: 1, h: 1, depths: [0, 0, 0, 0] },
        { chunk: 1, type: 2, format: 2, min: 0, max: 0, x: 0, y: 0, w: 1, h: 1, depths: [0, 0, 0, 0] },
        { chunk: 2, type: 3, format: 1, min: 0, max: 0, x: 0, y: 0, w: 1, h: 1, heights: [1, 1, 1, 1] },
      ]),
    );
    expect(createLiquidSpecs(instances, corners).map((s) => s.liquidType).sort()).toEqual([2, 3]);
  });
});

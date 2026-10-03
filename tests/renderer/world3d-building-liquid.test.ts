// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { LIQUID_UNIT, LIQUID_VERTEX_STRIDE } from '../../src/renderer/world3d/scene/map/loader/liquid';
import { createBuildingLiquidSpec, resolveLiquidType } from '../../src/renderer/world3d/scene/wmo/loader/liquid';

const liquid = (overrides: Partial<Parameters<typeof resolveLiquidType>[0]> = {}) => ({
  vertsX: 3,
  vertsY: 2,
  tilesX: 2,
  tilesY: 1,
  corner: [10, 20, 0] as [number, number, number],
  heights: new Float32Array([-6.5, -6.5, 0, -6.5, -6.5, 0]),
  // First tile water (type 0), second none (0x0F)
  tiles: new Uint8Array([0x00, 0x0f]),
  groupLiquid: 0,
  groupFlags: 0,
  ...overrides,
});

describe('which liquid a building group holds', () => {
  it('is the group’s own field when the building says it names LiquidType rows (Stormwind: 5 is WMO Water)', () => {
    expect(resolveLiquidType(liquid({ groupLiquid: 5 }), 0xf)).toBe(13);
    // ... or WMO Ocean where the group is flagged as ocean
    expect(resolveLiquidType(liquid({ groupLiquid: 5, groupFlags: 0x80000 }), 0xf)).toBe(14);
    // A row past the basic ones is used as it is
    expect(resolveLiquidType(liquid({ groupLiquid: 121 }), 0x4)).toBe(121);
  });

  it('is the tiles’ most common legacy type otherwise (Blackrock: tiles of 6 are Slow Magma, 7)', () => {
    expect(resolveLiquidType(liquid({ tiles: new Uint8Array([6, 6, 0x0f, 0]) }), 0)).toBe(7);
  });
});

describe('a building group’s liquid mesh', () => {
  it('runs from its corner along +X and +Y in the building’s space, with no triangles for an empty tile', () => {
    const spec = createBuildingLiquidSpec(liquid({ groupLiquid: 5 }), 0xf)!;
    expect(spec.liquidType).toBe(13);
    expect(spec.position).toEqual([0, 0, 0]);
    const vertices = new Float32Array(spec.vertexBuffer);
    const vertex = (i: number) => Array.from(vertices.subarray(i * LIQUID_VERTEX_STRIDE, i * LIQUID_VERTEX_STRIDE + 3));
    expect(vertex(0)).toEqual([10, 20, -6.5]);
    expect(vertex(1)[0]).toBeCloseTo(10 + LIQUID_UNIT, 4);
    expect(vertex(3)[1]).toBeCloseTo(20 + LIQUID_UNIT, 4);
    // One filled tile: two triangles
    expect(new Uint16Array(spec.indexBuffer)).toHaveLength(6);
    // Bounds from the drawn tile only, not the stray 0 heights beside the empty one
    expect(spec.bounds.extent[5]).toBeCloseTo(-6.5, 4);
  });

  it('is nothing when no tile has liquid', () => {
    expect(createBuildingLiquidSpec(liquid({ tiles: new Uint8Array([0x0f, 0x0f]) }), 0xf)).toBeNull();
  });
});

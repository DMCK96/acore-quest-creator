import { describe, expect, it } from 'vitest';
import { GRID_SIZE, gridBounds, gridOf, LEAFLET_TRANSFORM, MAX_ZOOM, MIN_ZOOM, pixel0ToWorld, pixelInGrid, tileGrids, TILE_PX, worldToPixel0 } from '../../src/core/map/coords';

describe('map coordinates', () => {
  it('puts the world origin in the middle of the zoom-0 map, north up and west left', () => {
    expect(worldToPixel0(0, 0)).toEqual({ px: 128, py: 128 });
    const north = worldToPixel0(1000, 0);
    const west = worldToPixel0(0, 1000);
    expect(north.py).toBeLessThan(128);
    expect(west.px).toBeLessThan(128);
  });
  it('round-trips between world and pixels', () => {
    const { px, py } = worldToPixel0(-8902.59, -162.606);
    const back = pixel0ToWorld(px, py);
    expect(back.x).toBeCloseTo(-8902.59, 6);
    expect(back.y).toBeCloseTo(-162.606, 6);
  });
  it('finds the grid the server uses', () => {
    expect(gridOf(-8902.59, -162.606)).toEqual({ gx: 48, gy: 32 });
    expect(gridOf(-1, -1)).toEqual({ gx: 32, gy: 32 });
  });
  it('maps tiles to grids at each zoom', () => {
    expect(tileGrids(6, 32, 48)).toEqual({ gx0: 48, gy0: 32, span: 1 });
    expect(tileGrids(5, 16, 24)).toEqual({ gx0: 48, gy0: 32, span: 2 });
    expect(tileGrids(2, 2, 3)).toEqual({ gx0: 48, gy0: 32, span: 16 });
  });
  it('gives a grid its edges', () => {
    const b = gridBounds(32, 32);
    expect(b.north).toBeCloseTo(0, 6);
    expect(b.south).toBeCloseTo(-GRID_SIZE, 6);
    expect(b.west).toBeCloseTo(0, 6);
    expect(b.east).toBeCloseTo(-GRID_SIZE, 6);
  });
  it('gives the world point under a pixel of a grid image', () => {
    const p = pixelInGrid(32, 32, 0, 0, 256);
    expect(p.x).toBeCloseTo(-GRID_SIZE / 512, 6);
    expect(p.y).toBeCloseTo(-GRID_SIZE / 512, 6);
    expect(gridOf(p.x, p.y)).toEqual({ gx: 32, gy: 32 });
  });
  it('exposes the Leaflet transformation and zoom range', () => {
    const k = TILE_PX / (64 * GRID_SIZE);
    expect(LEAFLET_TRANSFORM[0]).toBeCloseTo(-k, 12);
    expect(LEAFLET_TRANSFORM[1]).toBeCloseTo(32 * GRID_SIZE * k, 9);
    expect([MIN_ZOOM, MAX_ZOOM]).toEqual([2, 6]);
  });
});

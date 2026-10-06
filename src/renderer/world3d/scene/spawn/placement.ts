/**
 * Where a spawn stands in the 3D view, and which tile of the map an area is. Server units are the
 * scene's (yards, X north, Y west, Z up), so positions need no conversion.
 */
import * as THREE from 'three';

type Transform = { position: [number, number, number]; quaternion: [number, number, number, number]; scale: number };

/** The map's corner, and a tile's size: the world runs ±17066.666 yards from its middle */
const MAP_CORNER = 17066.666;
const TILE_SIZE = 533.3333;

const UP = new THREE.Vector3(0, 0, 1);

const scaleOf = (scale: number) => (Number.isFinite(scale) && scale > 0 ? scale : 1);

/** A creature turned about Z by its facing */
const creatureTransform = (c: { x: number; y: number; z: number; orientation: number; scale: number }): Transform => {
  const q = new THREE.Quaternion().setFromAxisAngle(UP, c.orientation || 0);
  return { position: [c.x, c.y, c.z], quaternion: [q.x, q.y, q.z, q.w], scale: scaleOf(c.scale) };
};

/** An object turned by its own rotation; an all-zero one (older rows) stands upright */
const objectTransform = (o: { x: number; y: number; z: number; rotation: [number, number, number, number]; scale: number }): Transform => {
  const blank = o.rotation.every((v) => v === 0);
  return {
    position: [o.x, o.y, o.z],
    quaternion: blank ? [0, 0, 0, 1] : [o.rotation[0], o.rotation[1], o.rotation[2], o.rotation[3]],
    scale: scaleOf(o.scale),
  };
};

/** A tile's bounds in server X and Y; areaX counts north to south, areaY west to east */
const areaBox = (areaX: number, areaY: number) => {
  const maxX = MAP_CORNER - areaX * TILE_SIZE;
  const maxY = MAP_CORNER - areaY * TILE_SIZE;
  return { minX: maxX - TILE_SIZE, maxX, minY: maxY - TILE_SIZE, maxY };
};

/** Areas per side of a map */
const AREAS_PER_SIDE = 64;

/**
 * The areas that get spawns: the camera's and those round it, as `areaX:areaY` keys. Terrain streams
 * much further; drawing every NPC and object that far choked the view.
 */
const nearbyAreas = (areaX: number, areaY: number, radius = 1): Set<string> => {
  const keys = new Set<string>();
  for (let x = areaX - radius; x <= areaX + radius; x++) {
    for (let y = areaY - radius; y <= areaY + radius; y++) {
      if (x >= 0 && y >= 0 && x < AREAS_PER_SIDE && y < AREAS_PER_SIDE) keys.add(`${x}:${y}`);
    }
  }
  return keys;
};

export { areaBox, creatureTransform, nearbyAreas, objectTransform };
export type { Transform };

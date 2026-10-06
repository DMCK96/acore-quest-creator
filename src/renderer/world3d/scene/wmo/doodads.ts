import * as THREE from 'three';
import { modelPath } from '../asset.js';
import type { MapDoodadDefSpec, MapObjDefSpec } from '../map/loader/types.js';
import type { WmoDoodadsSpec } from './loader/types.js';

/** The set every placement of a building shows: "Set_$DefaultGlobal" */
const DEFAULT_SET = 0;
/** A doodad def's scale is fixed precision: 1024 is full size */
const FULL_SCALE = 1024;

/**
 * A doodad name the client could hold: not a path on someone's own disk (`D:\...`, `/home/...`, left by
 * an editor in custom buildings) and not an extension alone. The game cannot load those either.
 */
const clientPath = (name: string): boolean => !/^([a-z]:[\\/]|[\\/])/i.test(name) && !/^\.\w+$/.test(name);

const building = new THREE.Matrix4();
const local = new THREE.Matrix4();
const position = new THREE.Vector3();
const rotation = new THREE.Quaternion();
const scale = new THREE.Vector3();

/**
 * A placed building's furniture and props, in the world: its default set and the set the placement
 * picks, each placed by the building's placement. Each is known by the placement's id and its index,
 * so a building placed in two neighbouring areas gives the same doodads twice and they are drawn once.
 * A doodad whose name the client could not hold is left out and passed to `onUnusable`.
 */
const interiorDoodads = (placement: MapObjDefSpec, doodads: WmoDoodadsSpec, onUnusable?: (name: string) => void): MapDoodadDefSpec[] => {
  building.compose(
    position.fromArray(placement.position),
    rotation.fromArray(placement.rotation),
    scale.set(1, 1, 1),
  );

  const sets = placement.doodadSet === DEFAULT_SET ? [DEFAULT_SET] : [DEFAULT_SET, placement.doodadSet];
  const out: MapDoodadDefSpec[] = [];
  for (const setIndex of sets) {
    const set = doodads.sets[setIndex];
    if (!set) continue;
    for (let index = set.startIndex; index < set.startIndex + set.count; index++) {
      const def = doodads.defs[index];
      if (!def?.name) continue;
      if (!clientPath(def.name)) {
        onUnusable?.(def.name);
        continue;
      }
      local.compose(position.fromArray(def.position), rotation.fromArray(def.rotation), scale.setScalar(def.scale));
      local.premultiply(building).decompose(position, rotation, scale);
      out.push({
        id: `${placement.id}:${index}`,
        name: modelPath(def.name),
        position: position.toArray(),
        rotation: rotation.toArray(),
        scale: scale.x * FULL_SCALE,
        building: placement.name,
      });
    }
  }
  return out;
};

export { interiorDoodads };

import type { Placement } from '@core/world/layer';

/**
 * Placing an existing NPC or object: the click's ground point, turned to face the camera (so a sign
 * or a mailbox shows its front, and an NPC looks at who put it there). An object is given its whole
 * rotation, a turn about Z, so it is drawn and written exactly as it faces.
 */

/** What is being placed: an existing NPC's or object's template */
export type PlaceTarget = { kind: 'creature' | 'object'; entry: number };

/** A click that placed one: where, and which template */
export type PlaceRequest = { target: PlaceTarget; at: Placement };

const TWO_PI = Math.PI * 2;

export function placementAt(ground: { x: number; y: number; z: number }, camera: { x: number; y: number }, kind: PlaceTarget['kind']): Placement {
  const yaw = Math.atan2(camera.y - ground.y, camera.x - ground.x);
  const orientation = yaw < 0 ? yaw + TWO_PI : yaw;
  return {
    x: ground.x,
    y: ground.y,
    z: ground.z,
    orientation,
    rotation: kind === 'object' ? [0, 0, Math.sin(orientation / 2), Math.cos(orientation / 2)] : null,
  };
}

/**
 * How often a model is posed (its bones worked out and sent to the GPU), by how far it is from the
 * camera: near ones every frame, distant ones every second or fourth. Between poses the shader
 * carries the last pose with the camera (see `ModelSkeleton#correct`), so a distant model only
 * animates less smoothly; it never slides about as the camera moves.
 */

/** Models nearer than this are posed every frame */
const EVERY_FRAME_DISTANCE = 80;
/** Models nearer than this (and not nearer than the above) every second frame; the rest every fourth */
const EVERY_SECOND_DISTANCE = 200;

export function skeletonInterval(distance: number): number {
  if (distance < EVERY_FRAME_DISTANCE) return 1;
  if (distance < EVERY_SECOND_DISTANCE) return 2;
  return 4;
}

/** Models further than this hold their last pose: at this range a figure is a few pixels, and its motion cannot be seen */
const FREEZE_DISTANCE = 250;
/** A frozen model moves again once nearer than this, so one at the edge does not start and stop with every step of the camera */
const THAW_DISTANCE = 220;

/** Whether a model's animation is held still, given how far it is and whether it was held a frame ago */
export function animationFrozen(distance: number, wasFrozen: boolean): boolean {
  return distance > (wasFrozen ? THAW_DISTANCE : FREEZE_DISTANCE);
}

/** Whether a model is posed this frame: those that wait are spread over the frames by their id */
export function skeletonDue(frame: number, id: number, interval: number): boolean {
  return (frame + id) % interval === 0;
}

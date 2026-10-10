/**
 * The arithmetic of moving and turning several things at once in the 3D view: they move together by
 * the drag (each by its share, for falloff), and turn together about Z round their middle.
 */

type At = { x: number; y: number; z: number };
type Quaternion = [number, number, number, number];

/** The middle of what is selected: the mean of the positions */
export function centreOf(items: At[]): At {
  if (items.length === 0) return { x: 0, y: 0, z: 0 };
  const sum = items.reduce((a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }), { x: 0, y: 0, z: 0 });
  return { x: sum.x / items.length, y: sum.y / items.length, z: sum.z / items.length };
}

/** Where a thing goes when it gets `weight` of the drag */
export function movedBy(start: At, delta: At, weight: number): At {
  return { x: start.x + delta.x * weight, y: start.y + delta.y * weight, z: start.z + delta.z * weight };
}

/** Swung round the centre about Z by an angle (radians, counter-clockwise), at the same height */
export function turnedAbout(start: At, centre: { x: number; y: number }, angle: number): At {
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
  const [dx, dy] = [start.x - centre.x, start.y - centre.y];
  return { x: centre.x + dx * cos - dy * sin, y: centre.y + dx * sin + dy * cos, z: start.z };
}

/** How far apart two facings may be (radians) and still count as the same one */
const SAME_FACING = 1e-4;

/** The way a rotation faces across the ground: the turn of its X axis about Z, tilt ignored */
function headingOf([x, y, z, w]: Quaternion): number {
  return Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
}

/** The facing (radians) that every one of these rotations shares, or null when they differ or there are none */
export function sharedHeading(rotations: Quaternion[]): number | null {
  const [first, ...rest] = rotations.map(headingOf);
  if (first === undefined) return null;
  const apart = (a: number) => Math.abs(Math.atan2(Math.sin(a - first), Math.cos(a - first)));
  return rest.every((h) => apart(h) < SAME_FACING) ? first : null;
}

/** A rotation turned about Z by an angle on top of what it was: the Z turn times the rotation */
export function turnQuaternion(q: Quaternion, angle: number): Quaternion {
  const [qx, qy, qz, qw] = q;
  const s = Math.sin(angle / 2);
  const c = Math.cos(angle / 2);
  // (0, 0, s, c) × (qx, qy, qz, qw)
  return [c * qx - s * qy, c * qy + s * qx, c * qz + s * qw, c * qw - s * qz];
}

/** A place the camera has been, to return to with Back */
export interface CameraPlace {
  map: number;
  x: number;
  y: number;
  z: number;
  label: string;
}

const SAME_YARDS = 1; // closer than this on every axis is the same place
export const BACK_CAP = 20;

const same = (a: CameraPlace, b: CameraPlace): boolean =>
  a.map === b.map && Math.abs(a.x - b.x) < SAME_YARDS && Math.abs(a.y - b.y) < SAME_YARDS && Math.abs(a.z - b.z) < SAME_YARDS;

/** Adds a place to the stack, unless it is where the last one is; keeps the latest `cap` */
export function pushPlace(stack: readonly CameraPlace[], place: CameraPlace, cap = BACK_CAP): CameraPlace[] {
  const last = stack[stack.length - 1];
  const next = last && same(last, place) ? [...stack] : [...stack, place];
  return next.slice(-cap);
}

/** Takes the last place off the stack */
export function popPlace(stack: readonly CameraPlace[]): { place: CameraPlace | null; stack: CameraPlace[] } {
  if (stack.length === 0) return { place: null, stack: [] };
  return { place: stack[stack.length - 1], stack: stack.slice(0, -1) };
}

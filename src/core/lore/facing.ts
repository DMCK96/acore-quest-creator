/**
 * Which way a spawn faces, in one place.
 *
 * World units are the server's: yards, X north, Y west, Z up. An orientation is radians: 0 faces +X
 * (north) and it grows toward +Y (west), so π/2 faces west, π south and 3π/2 east.
 */

export type Compass = 'N' | 'NW' | 'W' | 'SW' | 'S' | 'SE' | 'E' | 'NE';

const TAU = Math.PI * 2;
/** In order of growing orientation, eight 45° sectors centred on 0, π/4, π/2, … */
const WORDS: readonly Compass[] = ['N', 'NW', 'W', 'SW', 'S', 'SE', 'E', 'NE'];

/** Any finite orientation as 0 up to but not including 2π. */
export function normaliseOrientation(orientation: number): number {
  const wrapped = orientation % TAU;
  const positive = wrapped < 0 ? wrapped + TAU : wrapped;
  // -1e-17 % TAU + TAU can round up to exactly TAU
  return positive >= TAU ? 0 : positive;
}

/** The nearest of eight compass words for an orientation. */
export function compassOf(orientation: number): Compass {
  const sector = Math.round(normaliseOrientation(orientation) / (Math.PI / 4)) % WORDS.length;
  return WORDS[sector]!;
}

/** The orientation that faces `from` toward `to` (both in world yards, X north, Y west). */
export function orientationToward(from: { x: number; y: number }, to: { x: number; y: number }): number {
  return normaliseOrientation(Math.atan2(to.y - from.y, to.x - from.x));
}

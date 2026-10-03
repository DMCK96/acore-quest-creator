import type { Placement } from '@core/world/layer';

/**
 * What the 3D view's editing hands its host: a whole placement or a whole route, never a change by
 * so much, so an undo is just the earlier whole state sent again.
 */

/** The spawn an edit is for: `own` is one of the open quest's, else it is the world's */
export type SpawnRef = { kind: 'creature' | 'object'; guid: number; entry: number; own: boolean };

/** A route point; `carry` is what it keeps that the view does not edit (absent on a new point) */
export type EditPoint = { x: number; y: number; z: number; carry?: unknown };

export type SpawnEdit =
  | { kind: 'place'; spawn: SpawnRef; to: Placement }
  | { kind: 'route'; spawn: SpawnRef; pathId: number; points: EditPoint[] };

import type { Hit } from './selection';

/**
 * What a selection box drawn over the 3D view catches: the route points inside it if there are any,
 * else the NPCs and objects inside it. It catches what is behind a wall or a hill too, as box
 * selections usually do. Everything is tested by where it lands on screen.
 */

type At = { x: number; y: number; z: number };

/** Corners of the box in normalised device coordinates, in whichever order it was dragged */
export type Rect = { x0: number; y0: number; x1: number; y1: number };

/** What a box can catch, each with where it is in the world */
export type Candidates = {
  points: { guid: number; index: number; at: At }[];
  spawns: { kind: 'creature' | 'object'; guid: number; at: At }[];
};

export function boxHits(candidates: Candidates, project: (at: At) => At, rect: Rect): Hit {
  const [left, right] = [Math.min(rect.x0, rect.x1), Math.max(rect.x0, rect.x1)];
  const [bottom, top] = [Math.min(rect.y0, rect.y1), Math.max(rect.y0, rect.y1)];
  // In front of the camera and within the box
  const inside = (at: At): boolean => {
    const p = project(at);
    return p.z >= -1 && p.z <= 1 && p.x >= left && p.x <= right && p.y >= bottom && p.y <= top;
  };
  const points = candidates.points.filter((p) => inside(p.at)).map(({ guid, index }) => ({ guid, index }));
  if (points.length > 0) return { points };
  return { spawns: candidates.spawns.filter((s) => inside(s.at)).map(({ kind, guid }) => ({ kind, guid })) };
}

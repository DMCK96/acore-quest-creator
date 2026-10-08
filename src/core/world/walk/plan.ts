import type { ViewPoint } from '../../db/view-spawns';
import { waypointSettings } from '../waypoint-point';
import type { WalkPlan, WalkPoint } from './types';

type PlanSource = { x: number; y: number; z: number; orientation: number; wander: number; path: ViewPoint[] | null };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const isColumns = (value: Record<string, unknown>): value is Record<string, string | null> =>
  Object.values(value).every((v) => v === null || typeof v === 'string');

/** One point's wait and pace; a patrol point with no pace of its own keeps the pace of the one before. */
function pointOf(point: ViewPoint, previousRun: boolean): WalkPoint {
  const { x, y, z, carry } = point;
  if (isRecord(carry) && typeof carry['waitSecs'] === 'number') {
    const pace = carry['paceFromHere'];
    return { x, y, z, delay: Math.round(carry['waitSecs'] * 1000), run: pace === 'run' ? true : pace === 'walk' ? false : previousRun };
  }
  if (isRecord(carry) && isColumns(carry)) {
    const settings = waypointSettings(carry);
    return { x, y, z, delay: Math.round(settings.waitSecs * 1000), run: settings.moveType === 1 };
  }
  return { x, y, z, delay: 0, run: false };
}

/** How a drawn NPC moves: along its path if it has one, else around its wander radius, else not at all. */
export function walkPlanOf(c: PlanSource): WalkPlan {
  const home = { x: c.x, y: c.y, z: c.z };
  const facing = c.orientation || 0;
  if (c.path && c.path.length > 0) {
    const path: WalkPoint[] = [];
    let run = false;
    for (const p of c.path) {
      const point = pointOf(p, run);
      run = point.run;
      path.push(point);
    }
    return { type: 'path', home, facing, wander: 0, path };
  }
  if (c.wander > 0) return { type: 'wander', home, facing, wander: c.wander, path: null };
  return { type: 'idle', home, facing, wander: 0, path: null };
}

/** Equal for equal plans, so a changed plan can be told from an unchanged one. */
export function planKey(plan: WalkPlan): string {
  return JSON.stringify(plan);
}

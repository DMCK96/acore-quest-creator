/**
 * A database route point's settings, as the point dialog edits them: read from and written over its
 * `waypoint_data` columns (kept in the world layer as `rest`), every other column left as it was.
 */

type Rest = Readonly<Record<string, string | null>>;

/** What can be set for one point of a route the database has */
export interface WaypointSettings {
  /** How long the NPC waits at the point (`delay`, in milliseconds) */
  waitSecs: number;
  /** How it moves from here (`move_type`): 0 walks, 1 runs; another (landing, taking off) is kept */
  moveType: number;
  /** The way it faces while it waits (`orientation`, radians); null for none */
  facing: number | null;
  /** The waypoint script it runs here (`action`, a `waypoint_scripts` id); shown, not edited */
  script: number;
}

const numberOf = (text: string | null | undefined): number | null => {
  if (text === null || text === undefined || text.trim() === '') return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
};

/** A point's settings from its columns; a column the fork lacks, or one that is not a number, reads as nothing */
export function waypointSettings(rest: Rest): WaypointSettings {
  return {
    waitSecs: Math.max(0, numberOf(rest['delay']) ?? 0) / 1000,
    moveType: numberOf(rest['move_type']) ?? 0,
    facing: numberOf(rest['orientation']),
    script: numberOf(rest['action']) ?? 0,
  };
}

/** The point's columns with its settings written over them; a column the fork lacks is not added */
export function withWaypointSettings(rest: Rest, settings: WaypointSettings): Record<string, string | null> {
  const next: Record<string, string | null> = { ...rest };
  const put = (column: string, value: string | null): void => {
    if (Object.prototype.hasOwnProperty.call(rest, column)) next[column] = value;
  };
  put('delay', String(Math.round(Math.max(0, settings.waitSecs) * 1000)));
  put('move_type', String(settings.moveType));
  put('orientation', settings.facing === null ? null : String(settings.facing));
  return next;
}

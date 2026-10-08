/** Server-default walking pace in yards per second, used for the preview. */
export const WALK_SPEED = 2.5;
/** Server-default running pace in yards per second, used for the preview. */
export const RUN_SPEED = 7;
/** Shortest pause between two wander legs, in ms (server default, used for the preview). */
export const WANDER_PAUSE_MIN_MS = 3000;
/** Longest pause between two wander legs, in ms (server default, used for the preview). */
export const WANDER_PAUSE_MAX_MS = 10000;
/** How far below the drawn ground a row's height may sit and still stand on it, in yards (the server's floor snap). */
export const GROUND_REACH = 1.5;
/** How far a walker goes between two looks at the ground, in yards; its height follows the slope in between. */
export const PROBE_STEP = 0.5;
/** The steepest slope a wanderer's height follows between two looks at the ground (height per yard). */
export const MAX_GRADE = 2;

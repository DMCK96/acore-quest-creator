import type { MenuSpawn } from '../model';
import type { MenuSubject } from '../subject';

/** The subject shapes the sections narrow to */
export type GroundSubject = Extract<MenuSubject, { type: 'ground' }>;
export type SpawnSubject = Extract<MenuSubject, { type: 'spawn' }>;
export type RoutePointSubject = Extract<MenuSubject, { type: 'routePoint' }>;

/** "Copy" for one spawn, "Copy 3" for a selection of three */
export const counted = (label: string, n: number): string => (n > 1 ? `${label} ${n}` : label);

/** The spawns a right-click acts on: the selection, or the right-clicked spawn when nothing is selected */
export const chosen = (subject: GroundSubject | SpawnSubject): MenuSpawn[] =>
  subject.selection.length > 0 ? subject.selection : subject.type === 'spawn' ? [subject.info] : [];

import type { MenuSubject } from '../subject';

/** The subject shapes the sections narrow to */
export type GroundSubject = Extract<MenuSubject, { type: 'ground' }>;
export type SpawnSubject = Extract<MenuSubject, { type: 'spawn' }>;

/** "Copy" for one spawn, "Copy 3" for a selection of three */
export const counted = (label: string, n: number): string => (n > 1 ? `${label} ${n}` : label);

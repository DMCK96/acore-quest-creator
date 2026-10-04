import type { Placement } from '@core/world/layer';
import type { SpawnInfo } from './scene/spawn/SpawnManager';

/**
 * The 3D view's clipboard: spawns copied in the view, kept for the app's session (a map switch keeps
 * them, a restart does not). Each keeps its offset from the copied group's centre and how it faces,
 * so a paste puts the group down as it was laid out. A quest's own NPC is only pasted while that
 * quest is open, since only that quest can hold another spawn of it.
 */

export interface ClipEntry {
  kind: 'creature' | 'object';
  entry: number;
  name: string;
  own: boolean;
  /** The quest an own spawn belongs to; null for the world's */
  questId: number | null;
  /** Offset from the copied group's anchor (its centre), in yards */
  dx: number;
  dy: number;
  dz: number;
  orientation: number;
  rotation: [number, number, number, number] | null;
}

let entries: ClipEntry[] = [];

const mean = (values: number[]): number => values.reduce((sum, v) => sum + v, 0) / values.length;

/** Spawns as clipboard entries, without copying them (a duplicate leaves what was copied alone) */
export function entriesOf(spawns: readonly SpawnInfo[], questId: number | null): ClipEntry[] {
  if (spawns.length === 0) return [];
  const anchor = {
    x: mean(spawns.map((s) => s.placement.x)),
    y: mean(spawns.map((s) => s.placement.y)),
    z: mean(spawns.map((s) => s.placement.z)),
  };
  return spawns.map((s) => ({
    kind: s.kind,
    entry: s.entry,
    name: s.name,
    own: s.own,
    questId: s.own ? questId : null,
    dx: s.placement.x - anchor.x,
    dy: s.placement.y - anchor.y,
    dz: s.placement.z - anchor.z,
    orientation: s.placement.orientation,
    rotation: s.placement.rotation,
  }));
}

/** Copies spawns, replacing what was copied before; `questId` is the open quest, which own spawns belong to */
export function copySpawns(spawns: readonly SpawnInfo[], questId: number | null): ClipEntry[] {
  if (spawns.length > 0) entries = entriesOf(spawns, questId);
  return entries;
}

export const clipEntries = (): readonly ClipEntry[] => entries;

export function clearClipboard(): void {
  entries = [];
}

/**
 * Where each entry lands with the group's anchor at `at`, on the map being viewed. Each is at the
 * paste point's height: the caller drops each onto the floor where it lands.
 */
export function layoutAt(list: readonly ClipEntry[], at: { x: number; y: number; z: number }, map: number): { entry: ClipEntry; at: Placement; map: number }[] {
  return list.map((entry) => ({
    entry,
    at: { x: at.x + entry.dx, y: at.y + entry.dy, z: at.z, orientation: entry.orientation, rotation: entry.rotation },
    map,
  }));
}

/** Which entries can be pasted with this quest open (own ones only when it is theirs), and why any were left out */
export function pasteable(
  list: readonly ClipEntry[],
  openQuest: { id: number; title: string } | null,
  titles: (questId: number) => string,
): { entries: ClipEntry[]; blocked: string | null } {
  const kept = list.filter((e) => !e.own || (openQuest !== null && e.questId === openQuest.id));
  const left = list.find((e) => !kept.includes(e));
  return { entries: kept, blocked: left ? `Open ${titles(left.questId ?? 0)} to paste its NPC` : null };
}

/** Where a duplicate goes: two yards to the right of a camera looking along `direction` (X north, Y west) */
export function duplicateOffset(direction: { x: number; y: number }): { x: number; y: number } {
  const length = Math.hypot(direction.x, direction.y) || 1;
  const clean = (v: number): number => Math.round(v * 1e9) / 1e9 + 0;
  return { x: clean((direction.y / length) * 2), y: clean((-direction.x / length) * 2) };
}

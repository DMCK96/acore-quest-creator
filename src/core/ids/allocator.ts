import type { WorldDb } from '../db/world-db';

/** Highest quest id observed in Blizzlike world data. */
export const BLIZZLIKE_CEILING = 26034;

export interface IdRange {
  start: number;
  end: number;
}

export class RangeExhaustedError extends Error {
  constructor(range: IdRange) {
    super(`Quest id range ${range.start}-${range.end} has no free ids left`);
    this.name = 'RangeExhaustedError';
  }
}

export class IdCollisionError extends Error {
  constructor(public readonly questId: number) {
    super(`Quest id ${questId} already exists in quest_template`);
    this.name = 'IdCollisionError';
  }
}

export class InvalidRangeError extends Error {
  constructor(range: IdRange) {
    super(`Invalid quest id range ${range.start}-${range.end}: need safe integers with 1 <= start <= end`);
    this.name = 'InvalidRangeError';
  }
}

export function validateRange(range: IdRange): void {
  const { start, end } = range;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || start > end) {
    throw new InvalidRangeError(range);
  }
}

export function rangeOverlapsBlizzlike(range: IdRange): boolean {
  return range.start <= BLIZZLIKE_CEILING;
}

/** Lowest id in `range` that is not in `taken`. Ids outside the range are ignored. */
export function allocateQuestId(range: IdRange, taken: ReadonlySet<number>): number {
  validateRange(range);
  for (let id = range.start; id <= range.end; id++) {
    if (!taken.has(id)) return id;
  }
  throw new RangeExhaustedError(range);
}

/** World DB ids inside the range unioned with draft ids (drafts outside the range are kept). */
export async function collectTakenIds(
  db: WorldDb,
  range: IdRange,
  draftIds: readonly number[],
): Promise<Set<number>> {
  validateRange(range);
  const worldIds = await db.questIdsInRange(range.start, range.end);
  return new Set<number>([...worldIds, ...draftIds]);
}

export async function assertIdFree(db: WorldDb, questId: number): Promise<void> {
  const existing = await db.existingIds('quest', [questId]);
  if (existing.has(questId)) throw new IdCollisionError(questId);
}

import type { RawRow, SchemaInfo } from '../db/types';
import { buildPatch } from '../export/build-patch';
import type { QuestAggregate, Snapshot } from '../model/aggregate';
import type { Registry } from '../registry/types';
import { applyPatchInMemory, keyColumnsByTable } from './apply';
import { compareTables, type Difference } from './compare';

export type FidelityReport = { ok: true } | { ok: false; differences: Difference[] };

const show = (value: string | null | undefined): string =>
  value === undefined ? '(absent)' : value === null ? 'NULL' : JSON.stringify(value);

/** Thrown when export would not reproduce the imported rows exactly. */
export class FidelityError extends Error {
  readonly differences: Difference[];

  constructor(differences: Difference[]) {
    const shown = differences.slice(0, 5).map((d) => {
      // A whole-row difference has no before/after cell to show; `kind` is what says what happened.
      if (d.column === null && d.kind !== undefined) return `${d.table} ${d.key}: row ${d.kind}`;
      return `${d.table} ${d.key} ${d.column ?? '(row)'}: ${show(d.before)} -> ${show(d.after)}`;
    });
    const more = differences.length - shown.length;
    super(
      `Round trip is not lossless (${differences.length} difference${differences.length === 1 ? '' : 's'}): ` +
        shown.join('; ') +
        (more > 0 ? `; and ${more} more` : ''),
    );
    this.name = 'FidelityError';
    this.differences = differences;
  }
}

/**
 * The round-trip gate: exports the untouched aggregate, applies it to the snapshot rows in memory
 * and demands the result equals the snapshot exactly.
 */
export function verifyRoundTrip(args: {
  aggregate: QuestAggregate;
  snapshot: Snapshot;
  schema: SchemaInfo;
  registry: Registry;
}): FidelityReport {
  const { aggregate, snapshot, schema, registry } = args;
  const keys = keyColumnsByTable(registry);
  const { statements } = buildPatch({ aggregate, snapshot, schema, registry });
  const applied = applyPatchInMemory(snapshot.tables, statements, keys);

  // A table the fork lacks was never read, so there is nothing in it to compare.
  const present = (tables: Record<string, RawRow[]>): Record<string, RawRow[]> =>
    Object.fromEntries(Object.entries(tables).filter(([table]) => (snapshot.columnsRead[table] ?? []).length > 0));

  const differences = compareTables(present(snapshot.tables), present(applied), keys);
  return differences.length === 0 ? { ok: true } : { ok: false, differences };
}

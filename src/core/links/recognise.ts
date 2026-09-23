import type { ComponentDef, RecogniseInput } from './component';
import type { ComponentId, ComponentInstance, RowRef, ScriptRow } from './model';
import { CATALOG } from './catalog';

/**
 * Turns facts into the components that best explain them, resolving conflicts by catalog order: two
 * components can each think they recognise the same DB row (a value both plausibly explains), so the
 * first to run claims it and every later claim on that same row is dropped. Task 5 adds the fallback
 * that turns an unclaimed row into an `UnrecognisedRow` and infers `start.backend` for what nothing
 * else explains; this task always returns an empty `unrecognised` list.
 */

export interface UnrecognisedRow {
  questId: number;
  ref: RowRef;
  row: ScriptRow;
}

export interface RecognitionResult {
  instances: ComponentInstance[];
  unrecognised: UnrecognisedRow[];
}

const claimKey = (claim: RowRef): string => `${claim.table}\u0000${claim.key}\u0000${claim.column ?? ''}`;

export function recogniseLinks(
  input: RecogniseInput,
  catalog: readonly ComponentDef[] = CATALOG,
  available?: ReadonlySet<ComponentId>,
): RecognitionResult {
  const claimed = new Set<string>();
  const instances: ComponentInstance[] = [];
  for (const component of catalog) {
    if (available && !available.has(component.id)) continue;
    for (const instance of component.recognise(input)) {
      const keys = instance.claims.map(claimKey);
      if (keys.some((key) => claimed.has(key))) continue;
      for (const key of keys) claimed.add(key);
      instances.push(instance);
    }
  }
  return { instances, unrecognised: [] };
}

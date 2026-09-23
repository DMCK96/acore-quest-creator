import type { ComponentDef, RecogniseInput } from './component';
import { instanceId, scriptRowKey, type ComponentId, type ComponentInstance, type RowRef, type ScriptRow } from './model';
import { CATALOG } from './catalog';
import { questNamedBy } from './context';
import { BACKEND_READ_ONLY } from './components/smartai';

/**
 * Turns facts into the components that best explain them, resolving conflicts by catalog order: two
 * components can each think they recognise the same DB row (a value both plausibly explains), so the
 * first to run claims it and every later claim on that same row is dropped.
 *
 * Two things can only be decided once every component has run. An imported quest that nothing starts
 * is inferred to be started by the server's own code (`start.backend`), and a script row that names a
 * quest but that no component explains is surfaced as unrecognised, so the UI can show it rather than
 * silently hide behaviour it does not understand.
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

/**
 * Backend inference only runs when the caller's catalog includes `start.backend` and `available`
 * allows it, so a partial catalog (a test, or a fork missing tables) never invents starts it could
 * not have ruled out. Any accepted start counts, including a SmartAI script that will not run: the
 * row is still evidence the quest is started from the DB, and the inactive warning says the rest.
 */
function inferBackendStarts(
  input: RecogniseInput,
  instances: readonly ComponentInstance[],
  catalog: readonly ComponentDef[],
): ComponentInstance[] {
  const hooks = new Map(catalog.map((c) => [c.id, c.hook]));
  const started = new Set<number>();
  for (const instance of instances) {
    if (hooks.get(instance.component) === 'start' && instance.to.kind === 'quest') started.add(instance.to.questId);
  }
  const inferred: ComponentInstance[] = [];
  for (const facts of input.facts.values()) {
    if (facts.isNew || started.has(facts.questId)) continue;
    inferred.push({
      id: instanceId('start.backend', [], String(facts.questId)),
      component: 'start.backend',
      owner: facts.questId,
      from: { kind: 'backend' },
      to: { kind: 'quest', questId: facts.questId },
      params: {},
      claims: [],
      editable: false,
      readOnlyReason: BACKEND_READ_ONLY,
    });
  }
  return inferred;
}

function unrecognisedRows(input: RecogniseInput, instances: readonly ComponentInstance[]): UnrecognisedRow[] {
  const claimedScripts = new Set<string>();
  for (const instance of instances) {
    for (const claim of instance.claims) if (claim.table === 'smart_scripts') claimedScripts.add(claim.key);
  }
  const questIds = new Set(input.facts.keys());
  const rows: UnrecognisedRow[] = [];
  for (const row of input.context.questRows) {
    const key = scriptRowKey(row);
    if (claimedScripts.has(key)) continue;
    const questId = questNamedBy(row, questIds);
    if (questId === undefined) continue;
    rows.push({ questId, ref: { table: 'smart_scripts', key }, row });
  }
  return rows.sort((a, b) => a.questId - b.questId || (a.ref.key < b.ref.key ? -1 : a.ref.key > b.ref.key ? 1 : 0));
}

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
  const backendAvailable = catalog.some((c) => c.id === 'start.backend') && (!available || available.has('start.backend'));
  if (backendAvailable) instances.push(...inferBackendStarts(input, instances, catalog));
  return { instances, unrecognised: unrecognisedRows(input, instances) };
}

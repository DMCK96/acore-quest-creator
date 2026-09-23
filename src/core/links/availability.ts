import type { ColumnInfo } from '../db/types';
import type { ComponentDef, SchemaRequirement } from './component';
import { CATALOG } from './catalog';
import type { ComponentId } from './model';

/**
 * Whether the connected database can support a given built-in component. `loadSchema` already turns
 * a missing table or column into "absent from `tables`" rather than an error (a forbidden grant is
 * reported separately, via `SchemaInfo.forbidden`, and is not this function's concern); this just
 * walks each component's `requires` against that shape and names the first requirement that fails,
 * so the UI can explain why a component never shows up instead of it silently recognising nothing.
 */

export interface UnavailableComponent {
  component: ComponentId;
  label: string;
  reason: string;
}

export interface Availability {
  available: ReadonlySet<ComponentId>;
  unavailable: UnavailableComponent[];
}

function unmetReason(requirement: SchemaRequirement, columns: readonly ColumnInfo[] | undefined): string | undefined {
  if (columns === undefined) return `Needs table ${requirement.table}, which this database does not have.`;
  const names = new Set(columns.map((c) => c.name));
  for (const column of requirement.columns) {
    if (!names.has(column)) return `Needs ${requirement.table}.${column}, which this database does not have.`;
  }
  return undefined;
}

export function componentAvailability(
  tables: Readonly<Record<string, readonly ColumnInfo[]>>,
  catalog: readonly ComponentDef[] = CATALOG,
): Availability {
  const available = new Set<ComponentId>();
  const unavailable: UnavailableComponent[] = [];
  for (const component of catalog) {
    let reason: string | undefined;
    for (const requirement of component.requires) {
      reason = unmetReason(requirement, tables[requirement.table]);
      if (reason !== undefined) break;
    }
    if (reason === undefined) available.add(component.id);
    else unavailable.push({ component: component.id, label: component.label, reason });
  }
  return { available, unavailable };
}

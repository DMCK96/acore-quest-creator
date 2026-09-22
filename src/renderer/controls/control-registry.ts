import type { ControlId } from '@core/registry/types';
import type { FieldControl } from './types';

/**
 * The mutable map `resolveControl` reads and `registerControl` writes, split into its own
 * dependency-free module so `resolve.ts` can import `register.ts` for side effects without a
 * circular import: `register.ts` writes here directly rather than back through `resolve.ts`.
 */
export const controlRegistry: Partial<Record<ControlId, FieldControl>> = {};

export function registerControl(id: ControlId, control: FieldControl): void {
  controlRegistry[id] = control;
}

import type { FieldDef, ListMemberDef, RowSetColumn, ScalarType } from '@core/registry/types';

/**
 * Props every control shares, whether it edits a scalar field, a list member or a row-set cell.
 *
 * `def` and `type` are accepted by every control (so `resolveControl`'s callers can pass them
 * uniformly through the `FieldControl` signature) even though a given control may not read them;
 * a control that needs a specific scalar shape narrows `type` further in its own prop type.
 */
export interface ControlProps<V> {
  id: string;
  label: string;
  help?: string;
  value: V;
  onChange(next: V): void;
  disabled?: boolean;
  readOnlyReason?: string;
  def?: FieldDef | ListMemberDef | RowSetColumn;
  type?: ScalarType;
}

/**
 * A React component that edits one value. `def` is the field/member/column definition it was
 * resolved for, and `type` is the scalar type it should render for (controls for list members and
 * row-set columns are passed `def.type` this way rather than a full `FieldDef`).
 */
export type FieldControl = (
  props: ControlProps<any> & { def: FieldDef | ListMemberDef | RowSetColumn; type?: ScalarType },
) => React.JSX.Element;

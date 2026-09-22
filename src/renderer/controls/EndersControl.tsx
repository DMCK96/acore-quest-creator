import type { RowSetFieldDef, RowSetValue } from '@core/registry/types';
import { RowIdListControl } from './StartersControl';
import type { ControlProps } from './types';

/**
 * Turned-in-to and area-trigger-completion rowsets. Shares `RowIdListControl` with
 * `StartersControl`: which table it edits, and so which group name and id kind it shows, comes
 * entirely from `def.id`.
 */
export function EndersControl(props: ControlProps<RowSetValue> & { def: RowSetFieldDef }): React.JSX.Element {
  return <RowIdListControl {...props} />;
}

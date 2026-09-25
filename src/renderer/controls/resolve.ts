import type { FieldDef, ListMemberDef, RowSetColumn, ScalarType } from '@core/registry/types';
import './controls.css';
import { controlRegistry, registerControl } from './control-registry';
import { CreatureOrGoControl } from './CreatureOrGoControl';
import { EnumControl } from './EnumControl';
import { FlagsControl } from './FlagsControl';
import { FloatControl } from './FloatControl';
import { IdRefControl } from './IdRefControl';
import { IntControl } from './IntControl';
import { ListEditor } from './ListEditor';
import { LongTextControl } from './LongTextControl';
import { MoneyControl } from './MoneyControl';
import { RowSetEditor } from './RowSetEditor';
import { TextControl } from './TextControl';
import type { FieldControl } from './types';

/** Thrown by `resolveControl` when no control applies; callers must not fall back to a generic one. */
export class NoControlError extends Error {}

const scalarControls: Partial<Record<ScalarType['kind'], FieldControl>> = {
  int: IntControl as unknown as FieldControl,
  float: FloatControl as unknown as FieldControl,
  string: TextControl as unknown as FieldControl,
  text: LongTextControl as unknown as FieldControl,
  enum: EnumControl as unknown as FieldControl,
  flags: FlagsControl as unknown as FieldControl,
  idRef: IdRefControl as unknown as FieldControl,
  money: MoneyControl as unknown as FieldControl,
  creatureOrGo: CreatureOrGoControl as unknown as FieldControl,
};

/** Re-exported from `./control-registry` so existing importers of `resolve.ts` keep working. */
export { controlRegistry, registerControl };

function resolveScalar(type: ScalarType): FieldControl {
  const control = scalarControls[type.kind];
  if (!control) throw new NoControlError(`No control registered for scalar kind "${type.kind}".`);
  return control;
}

/**
 * Picks the control to render for a field/list-member/row-set-column definition.
 *
 * `def.control` (looked up in `controlRegistry`) wins when both it and a matching registration
 * exist; otherwise a list/row-set shape gets its editor and a scalar is resolved by `type.kind`.
 * A shape or type this cannot place throws `NoControlError` rather than a generic fallback, so a
 * gap in the registry is loud instead of silently rendering the wrong editor.
 */
export function resolveControl(def: FieldDef | ListMemberDef | RowSetColumn): FieldControl {
  if ('shape' in def) {
    if (def.control) {
      const registered = controlRegistry[def.control];
      if (registered) return registered;
    }
    if (def.shape === 'list') return ListEditor as unknown as FieldControl;
    if (def.shape === 'rowset') return RowSetEditor as unknown as FieldControl;
    return resolveScalar(def.type);
  }
  return resolveScalar(def.type);
}

// Registers the raceMask/classMask/questSort/emote controls into `controlRegistry` above. Imported
// for its side effects, last, so every export above is already assigned by the time it runs.
import './register';

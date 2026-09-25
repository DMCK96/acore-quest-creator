import type { ScalarType } from '@core/registry/types';
import { useName } from '../state/names';
import type { ControlProps, FieldControl } from './types';

type IdRefType = Extract<ScalarType, { kind: 'idRef' }>;

export function IdRefControl(props: ControlProps<number> & { type: IdRefType }): React.JSX.Element {
  const { id, label, help, value, onChange, disabled, readOnlyReason, type } = props;
  const { state, name } = useName(type.target, value);

  return (
    <div className="control">
      <label htmlFor={id} className="control__label">{label}</label>
      {help && <p className="control__help">{help}</p>}
      <input
        id={id}
        type="number"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
      />
      {state === 'found' && <p className="control__note">{name}</p>}
      {state === 'missing' && <p className="control__alert">ID not found in your database.</p>}
      {readOnlyReason && <p role="alert" className="control__alert">{readOnlyReason}</p>}
    </div>
  );
}

export const IdRefFieldControl = IdRefControl as unknown as FieldControl;

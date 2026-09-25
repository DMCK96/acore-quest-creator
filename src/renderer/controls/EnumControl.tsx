import type { ScalarType } from '@core/registry/types';
import type { ControlProps, FieldControl } from './types';

type EnumType = Extract<ScalarType, { kind: 'enum' }>;

export function EnumControl(props: ControlProps<number> & { type: EnumType }): React.JSX.Element {
  const { id, label, help, value, onChange, disabled, readOnlyReason, type } = props;
  const known = type.options.some((o) => o.value === value);
  const options = known ? type.options : [...type.options, { value, label: `Unknown (${value})` }];

  return (
    <div className="control">
      <label htmlFor={id} className="control__label">{label}</label>
      {help && <p className="control__help">{help}</p>}
      <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {readOnlyReason && <p role="alert" className="control__alert">{readOnlyReason}</p>}
    </div>
  );
}

export const EnumFieldControl = EnumControl as unknown as FieldControl;

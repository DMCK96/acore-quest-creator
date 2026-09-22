import type { ScalarType } from '@core/registry/types';
import type { ControlProps, FieldControl } from './types';

type EnumType = Extract<ScalarType, { kind: 'enum' }>;

export function EnumControl(props: ControlProps<number> & { type: EnumType }): React.JSX.Element {
  const { id, label, help, value, onChange, disabled, readOnlyReason, type } = props;
  const known = type.options.some((o) => o.value === value);
  const options = known ? type.options : [...type.options, { value, label: `Unknown (${value})` }];

  return (
    <div>
      <label htmlFor={id}>{label}</label>
      {help && <p>{help}</p>}
      <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {readOnlyReason && <p role="alert">{readOnlyReason}</p>}
    </div>
  );
}

export const EnumFieldControl = EnumControl as unknown as FieldControl;

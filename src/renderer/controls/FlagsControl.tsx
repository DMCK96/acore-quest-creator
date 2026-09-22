import type { ScalarType } from '@core/registry/types';
import type { ControlProps, FieldControl } from './types';

type FlagsType = Extract<ScalarType, { kind: 'flags' }>;

export function FlagsControl(props: ControlProps<number> & { type: FlagsType }): React.JSX.Element {
  const { id, label, help, value, onChange, disabled, readOnlyReason, type } = props;
  const knownMask = type.flags.reduce((mask, f) => mask | f.bit, 0);
  const unknown = value & ~knownMask;

  function toggle(bit: number, checked: boolean): void {
    onChange(checked ? value | bit : value & ~bit);
  }

  return (
    <div>
      <span id={`${id}-label`}>{label}</span>
      {help && <p>{help}</p>}
      <div role="group" aria-labelledby={`${id}-label`}>
        {type.flags.map((f) => (
          <label key={f.bit}>
            <input
              type="checkbox"
              checked={(value & f.bit) !== 0}
              disabled={disabled}
              onChange={(e) => toggle(f.bit, e.target.checked)}
            />
            {f.label}
          </label>
        ))}
      </div>
      {unknown !== 0 && <p>Unknown bits set: 0x{unknown.toString(16)}</p>}
      <details>
        <summary>Raw value</summary>
        {value}
      </details>
      {readOnlyReason && <p role="alert">{readOnlyReason}</p>}
    </div>
  );
}

export const FlagsFieldControl = FlagsControl as unknown as FieldControl;

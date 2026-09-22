import { useState } from 'react';
import type { ScalarType } from '@core/registry/types';
import type { ControlProps, FieldControl } from './types';
import { useLocalText } from './useLocalText';

type IntType = Extract<ScalarType, { kind: 'int' }>;

export function IntControl(props: ControlProps<number | null> & { type: IntType }): React.JSX.Element {
  const { id, label, help, value, onChange, disabled, readOnlyReason, type } = props;
  const { text, setText, commit } = useLocalText(value, (v) => (v === null || v === undefined ? '' : String(v)));
  const [error, setError] = useState<string | null>(null);

  function handleChange(raw: string): void {
    setText(raw);
    if (!/^-?\d+$/.test(raw)) {
      setError('Enter a whole number.');
      return;
    }
    const n = Number(raw);
    if (type.min !== undefined && n < type.min) {
      setError(`Must be at least ${type.min}.`);
      return;
    }
    if (type.max !== undefined && n > type.max) {
      setError(`Must be at most ${type.max}.`);
      return;
    }
    setError(null);
    commit(n);
    onChange(n);
  }

  return (
    <div>
      <label htmlFor={id}>{label}</label>
      {help && <p>{help}</p>}
      <input id={id} value={text} disabled={disabled} onChange={(e) => handleChange(e.target.value)} />
      {error && <p role="alert">{error}</p>}
      {readOnlyReason && <p role="alert">{readOnlyReason}</p>}
    </div>
  );
}

export const IntFieldControl = IntControl as unknown as FieldControl;

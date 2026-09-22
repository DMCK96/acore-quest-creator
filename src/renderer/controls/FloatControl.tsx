import { useState } from 'react';
import type { ScalarType } from '@core/registry/types';
import type { ControlProps, FieldControl } from './types';
import { useLocalText } from './useLocalText';

type FloatType = Extract<ScalarType, { kind: 'float' }>;

const FLOAT_RE = /^-?(\d+(\.\d*)?|\.\d+)$/;

export function FloatControl(props: ControlProps<number | null> & { type?: FloatType }): React.JSX.Element {
  const { id, label, help, value, onChange, disabled, readOnlyReason } = props;
  const { text, setText, commit } = useLocalText(value, (v) => (v === null || v === undefined ? '' : String(v)));
  const [error, setError] = useState<string | null>(null);

  function handleChange(raw: string): void {
    setText(raw);
    if (!FLOAT_RE.test(raw)) {
      setError('Enter a number.');
      return;
    }
    const n = Number(raw);
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

export const FloatFieldControl = FloatControl as unknown as FieldControl;

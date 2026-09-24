import { useEffect, useRef, useState } from 'react';
import type { SearchKind } from '@core/db/world-db';
import { EntityPicker } from '../controls/EntityPicker';

/** Small labelled inputs the scene editor is built from; each is a label around its control. */

export function NumberField({ label, value, onChange, min }: { label: string; value: number; onChange(n: number): void; min?: number }): React.JSX.Element {
  return (
    <label className="scene-field scene-field--short">
      <span>{label}</span>
      <input type="number" step="any" min={min} value={value} onChange={(e) => onChange(Number(e.target.value) || 0)} />
    </label>
  );
}

/**
 * Text keeps its own copy while the author types, and follows the stored value when it changes from
 * elsewhere, so a keystroke is never lost to a save that has not come back yet.
 */
export function TextField({ label, value, onChange, long }: { label: string; value: string; onChange(s: string): void; long?: boolean }): React.JSX.Element {
  const [local, setLocal] = useState(value);
  const lastKnown = useRef(value);
  useEffect(() => {
    if (value !== lastKnown.current) {
      lastKnown.current = value;
      setLocal(value);
    }
  }, [value]);
  const change = (next: string): void => {
    setLocal(next);
    lastKnown.current = next;
    onChange(next);
  };
  return (
    <label className="scene-field">
      <span>{label}</span>
      {long ? (
        <textarea rows={3} value={local} onChange={(e) => change(e.target.value)} />
      ) : (
        <input type="text" value={local} onChange={(e) => change(e.target.value)} />
      )}
    </label>
  );
}

export function CheckField({ label, value, onChange }: { label: string; value: boolean; onChange(b: boolean): void }): React.JSX.Element {
  return (
    <label className="scene-field scene-field--check">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange(v: T): void;
}): React.JSX.Element {
  return (
    <label className="scene-field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A name search for an NPC, object or item, falling back to typing the ID. */
export function EntityField({ id, label, kind, value, onChange }: { id: string; label: string; kind: SearchKind; value: number; onChange(n: number): void }): React.JSX.Element {
  return (
    <div className="scene-field scene-field--entity">
      <EntityPicker id={id} label={label} kind={kind} value={value} onChange={onChange} />
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import type { ControlProps, FieldControl } from './types';

interface Split {
  gold: number;
  silver: number;
  copper: number;
  negative: boolean;
}

function splitCopper(value: number): Split {
  const negative = value < 0;
  const abs = Math.abs(value);
  return { gold: Math.floor(abs / 10000), silver: Math.floor((abs % 10000) / 100), copper: abs % 100, negative };
}

function toCopper(s: Split): number {
  const total = s.gold * 10000 + s.silver * 100 + s.copper;
  return s.negative ? -total : total;
}

/** Splits a signed copper amount into gold/silver/copper inputs, with a sign toggle for a cost. */
export function MoneyControl(props: ControlProps<number>): React.JSX.Element {
  const { id, label, help, value, onChange, disabled, readOnlyReason } = props;
  const [local, setLocal] = useState(() => splitCopper(value));
  const lastKnown = useRef(value);

  useEffect(() => {
    if (!Object.is(value, lastKnown.current)) {
      lastKnown.current = value;
      setLocal(splitCopper(value));
    }
  }, [value]);

  function commit(next: Split): void {
    setLocal(next);
    const signed = toCopper(next);
    lastKnown.current = signed;
    onChange(signed);
  }

  return (
    <fieldset className="control">
      <legend className="control__label">{label}</legend>
      {help && <p className="control__help">{help}</p>}
      <div className="control__inline">
        <div className="control__sub">
          <label htmlFor={`${id}-gold`}>Gold</label>
          <input
            id={`${id}-gold`}
            type="number"
            value={local.gold}
            disabled={disabled}
            onChange={(e) => commit({ ...local, gold: Number(e.target.value) || 0 })}
          />
        </div>
        <div className="control__sub">
          <label htmlFor={`${id}-silver`}>Silver</label>
          <input
            id={`${id}-silver`}
            type="number"
            value={local.silver}
            disabled={disabled}
            onChange={(e) => commit({ ...local, silver: Number(e.target.value) || 0 })}
          />
        </div>
        <div className="control__sub">
          <label htmlFor={`${id}-copper`}>Copper</label>
          <input
            id={`${id}-copper`}
            type="number"
            value={local.copper}
            disabled={disabled}
            onChange={(e) => commit({ ...local, copper: Number(e.target.value) || 0 })}
          />
        </div>
      </div>
      <label className="control__check">
        <input
          type="checkbox"
          checked={local.negative}
          disabled={disabled}
          onChange={(e) => commit({ ...local, negative: e.target.checked })}
        />
        Deduct from the player instead of rewarding them
      </label>
      {local.negative && <p className="control__note">This costs the player money.</p>}
      {readOnlyReason && <p role="alert" className="control__alert">{readOnlyReason}</p>}
    </fieldset>
  );
}

export const MoneyFieldControl = MoneyControl as unknown as FieldControl;

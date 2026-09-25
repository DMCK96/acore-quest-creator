import { CLASSES } from './game-data';
import type { ControlProps, FieldControl } from './types';

const KNOWN_MASK = CLASSES.reduce((mask, c) => mask | c.bit, 0);

/**
 * Edits an `AllowableClasses`-shaped bitmask. Mirrors `RaceMaskControl`'s "all" handling for `0`
 * and the legacy "every bit set" value, but has no faction-style presets since classes have none.
 */
export function ClassMaskControl(props: ControlProps<number>): React.JSX.Element {
  const { id, label, help, value, onChange, disabled, readOnlyReason } = props;
  const isAll = value === 0 || (value & KNOWN_MASK) === KNOWN_MASK;

  function toggleAll(checked: boolean): void {
    if (checked) onChange(0);
  }

  function toggleClass(bit: number, checked: boolean): void {
    if (isAll) {
      onChange(checked ? bit : 0);
    } else {
      onChange(checked ? value | bit : value & ~bit);
    }
  }

  return (
    <div className="control">
      <span id={`${id}-label`} className="control__label">{label}</span>
      {help && <p className="control__help">{help}</p>}
      <label className="control__check">
        <input type="checkbox" checked={isAll} disabled={disabled} onChange={(e) => toggleAll(e.target.checked)} />
        All classes
      </label>
      <div role="group" className="control__checks" aria-labelledby={`${id}-label`}>
        {CLASSES.map((c) => (
          <label className="control__check" key={c.bit}>
            <input
              type="checkbox"
              checked={!isAll && (value & c.bit) !== 0}
              disabled={disabled}
              onChange={(e) => toggleClass(c.bit, e.target.checked)}
            />
            {c.label}
          </label>
        ))}
      </div>
      {readOnlyReason && <p role="alert" className="control__alert">{readOnlyReason}</p>}
    </div>
  );
}

export const ClassMaskFieldControl = ClassMaskControl as unknown as FieldControl;

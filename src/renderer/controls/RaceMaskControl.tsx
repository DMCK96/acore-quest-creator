import { ALLIANCE_MASK, HORDE_MASK, RACES } from './game-data';
import type { ControlProps, FieldControl } from './types';

const KNOWN_MASK = RACES.reduce((mask, r) => mask | r.bit, 0);

/**
 * Edits a `AllowableRaces`-shaped bitmask.
 *
 * `0` and the legacy "every bit set" value (`4294967295`) both mean "every race" and are shown as
 * the "All races" checkbox being checked; neither is rewritten just by rendering. Checking that
 * box emits `0`. Ticking a single race while the mask is in either "all" state starts a fresh mask
 * from just that race's bit (not from the legacy value's other bits); toggling a race in an
 * already-specific mask only flips that bit, so unknown bits elsewhere in the mask survive.
 */
export function RaceMaskControl(props: ControlProps<number>): React.JSX.Element {
  const { id, label, help, value, onChange, disabled, readOnlyReason } = props;
  const isAll = value === 0 || (value & KNOWN_MASK) === KNOWN_MASK;

  function toggleAll(checked: boolean): void {
    if (checked) onChange(0);
  }

  function toggleRace(bit: number, checked: boolean): void {
    if (isAll) {
      onChange(checked ? bit : 0);
    } else {
      onChange(checked ? value | bit : value & ~bit);
    }
  }

  return (
    <div>
      <span id={`${id}-label`}>{label}</span>
      {help && <p>{help}</p>}
      <label>
        <input type="checkbox" checked={isAll} disabled={disabled} onChange={(e) => toggleAll(e.target.checked)} />
        All races
      </label>
      <div>
        <button type="button" disabled={disabled} onClick={() => onChange(ALLIANCE_MASK)}>
          Alliance only
        </button>
        <button type="button" disabled={disabled} onClick={() => onChange(HORDE_MASK)}>
          Horde only
        </button>
      </div>
      <div role="group" aria-labelledby={`${id}-label`}>
        {RACES.map((r) => (
          <label key={r.bit}>
            <input
              type="checkbox"
              checked={!isAll && (value & r.bit) !== 0}
              disabled={disabled}
              onChange={(e) => toggleRace(r.bit, e.target.checked)}
            />
            {r.label}
          </label>
        ))}
      </div>
      {readOnlyReason && <p role="alert">{readOnlyReason}</p>}
    </div>
  );
}

export const RaceMaskFieldControl = RaceMaskControl as unknown as FieldControl;

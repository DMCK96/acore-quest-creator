import { QUEST_SORTS } from './game-data';
import type { ControlProps, FieldControl } from './types';

type Mode = 'zone' | 'category';

/**
 * Edits `QuestSortID`: a positive value is a zone from AreaTable.dbc, a negative value is a
 * `QuestSort` category id with the sign flipped, and `0` is treated as the zone mode (no zone
 * chosen yet). Switching the "Sorted by" mode resets the value to `0` rather than guessing a
 * translation between the two id spaces.
 */
export function QuestSortControl(props: ControlProps<number>): React.JSX.Element {
  const { id, label, help, value, onChange, disabled, readOnlyReason } = props;
  const mode: Mode = value < 0 ? 'category' : 'zone';

  function setMode(next: Mode): void {
    if (next !== mode) onChange(0);
  }

  return (
    <div>
      <span id={`${id}-label`}>{label}</span>
      {help && <p>{help}</p>}
      <label htmlFor={`${id}-mode`}>Sorted by</label>
      <select
        id={`${id}-mode`}
        value={mode}
        disabled={disabled}
        onChange={(e) => setMode(e.target.value as Mode)}
      >
        <option value="zone">Zone</option>
        <option value="category">Category</option>
      </select>
      {mode === 'category' ? (
        <>
          <label htmlFor={`${id}-category`}>Category</label>
          <select
            id={`${id}-category`}
            value={String(-value)}
            disabled={disabled}
            onChange={(e) => onChange(-Number(e.target.value))}
          >
            {QUEST_SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </>
      ) : (
        <>
          <label htmlFor={`${id}-zone`}>Zone ID</label>
          <input
            id={`${id}-zone`}
            type="number"
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(Number(e.target.value) || 0)}
          />
          <p>The client zone name is not stored in the world DB; this is the raw AreaTable.dbc ID.</p>
        </>
      )}
      {readOnlyReason && <p role="alert">{readOnlyReason}</p>}
    </div>
  );
}

export const QuestSortFieldControl = QuestSortControl as unknown as FieldControl;

import { useEffect, useState } from 'react';
import type { ModuleBodyProps } from '../body-props';

const FIELD = 'quest_template.TimeAllowed';

/** The time limit as minutes and seconds; the column stores seconds. */
export function TimerBody({ open, onChange }: ModuleBodyProps): React.JSX.Element {
  const stored = Number(open.aggregate.values[FIELD] ?? 0);
  const [minutes, setMinutes] = useState(String(Math.floor(stored / 60)));
  const [seconds, setSeconds] = useState(String(stored % 60));

  // Follow the stored value when it changes from elsewhere (reset, undo, another quest).
  useEffect(() => {
    if (Number(minutes) * 60 + Number(seconds) === stored) return;
    setMinutes(String(Math.floor(stored / 60)));
    setSeconds(String(stored % 60));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored]);

  if (!Object.prototype.hasOwnProperty.call(open.aggregate.values, FIELD)) return <p>This database has no time limit column.</p>;
  const disabled = open.aggregate.readOnly.some((r) => r.fieldId === FIELD);

  function update(nextMinutes: string, nextSeconds: string): void {
    setMinutes(nextMinutes);
    setSeconds(nextSeconds);
    const whole = /^\d*$/;
    if (!whole.test(nextMinutes) || !whole.test(nextSeconds)) return;
    onChange(FIELD, Number(nextMinutes || 0) * 60 + Number(nextSeconds || 0));
  }

  return (
    <div className="field-setting control" data-field={FIELD}>
      <p className="control__help">The quest fails if it is not completed within this time. Zero means no limit.</p>
      <div className="control__inline">
        <div className="control__sub">
          <label htmlFor={`${FIELD}.minutes`}>Minutes</label>
          <input id={`${FIELD}.minutes`} className="timer__box" inputMode="numeric" value={minutes} disabled={disabled}
            onChange={(e) => update(e.target.value, seconds)} />
        </div>
        <div className="control__sub">
          <label htmlFor={`${FIELD}.seconds`}>Seconds</label>
          <input id={`${FIELD}.seconds`} className="timer__box" inputMode="numeric" value={seconds} disabled={disabled}
            onChange={(e) => update(minutes, e.target.value)} />
        </div>
      </div>
    </div>
  );
}

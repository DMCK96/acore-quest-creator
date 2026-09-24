import { useState } from 'react';
import { parseGps } from '@core/scripts/gps';
import type { Position } from '@core/scripts/model';

const AXES = ['x', 'y', 'z', 'o'] as const;
const AXIS_LABEL = { x: 'X', y: 'Y', z: 'Z', o: 'Facing' } as const;

/**
 * A position as four numbers, with a box to paste the server's `.gps` output into so an author can
 * copy where they stand in game. A paste reports the position and the map it names in one change, so
 * a caller never applies one on top of a stale copy of the other.
 */
export function PositionInput({
  idPrefix,
  value,
  onChange,
}: {
  idPrefix: string;
  value: Position;
  /** `map` is set only when pasted `.gps` text named one. */
  onChange(next: Position, map?: number): void;
}): React.JSX.Element {
  const [paste, setPaste] = useState('');

  function fromText(text: string): void {
    setPaste(text);
    const parsed = parseGps(text);
    if (!parsed) return;
    onChange({ x: parsed.x, y: parsed.y, z: parsed.z, o: parsed.o }, parsed.map);
  }

  return (
    <div className="position-input">
      <div className="position-input__axes">
        {AXES.map((axis) => (
          <label key={axis} className="scene-field scene-field--short">
            <span>{AXIS_LABEL[axis]}</span>
            <input
              id={`${idPrefix}-${axis}`}
              type="number"
              step="any"
              value={value[axis]}
              onChange={(e) => onChange({ ...value, [axis]: Number(e.target.value) || 0 })}
            />
          </label>
        ))}
      </div>
      <label className="scene-field">
        <span>Paste .gps output</span>
        <textarea
          rows={2}
          value={paste}
          placeholder="Type .gps in game, then paste what it prints here"
          onChange={(e) => fromText(e.target.value)}
        />
      </label>
    </div>
  );
}

import { useState } from 'react';
import { parseGps } from '@core/scripts/gps';
import type { Position } from '@core/scripts/model';
import { useApi } from '../state/names';
import { usePlaceInWorld } from '../world3d/ShowInWorldContext';

const AXES = ['x', 'y', 'z', 'o'] as const;
const AXIS_LABEL = { x: 'X', y: 'Y', z: 'Z', o: 'Facing' } as const;

/**
 * A position as four numbers, with a box to paste the server's `.gps` output into so an author can
 * copy where they stand in game. A paste reports the position and the map it names in one change, so
 * a caller never applies one on top of a stale copy of the other. With a `map`, a button fills Z
 * from the server's terrain at X and Y.
 */
export function PositionInput({
  idPrefix,
  value,
  onChange,
  map,
  markerId,
  onShowInWorld,
}: {
  idPrefix: string;
  value: Position;
  /** `map` is set only when pasted `.gps` text named one. */
  onChange(next: Position, map?: number): void;
  /** The map the position is on; without one there is no ground to snap to. */
  map?: number;
  /** The quest's marker for this position (see `questMarkers`); with it, Show in World takes the World to it. */
  markerId?: string;
  /** Shows what stands at this position in the World; with it, a Show in World link does */
  onShowInWorld?(): void;
}): React.JSX.Element {
  const [paste, setPaste] = useState('');
  const [groundNote, setGroundNote] = useState<string | null>(null);
  const api = useApi();
  const world = usePlaceInWorld();

  function fromText(text: string): void {
    setPaste(text);
    const parsed = parseGps(text);
    if (!parsed) return;
    onChange({ x: parsed.x, y: parsed.y, z: parsed.z, o: parsed.o }, parsed.map);
  }

  async function snap(): Promise<void> {
    if (map === undefined || !api) return;
    const result = await api.groundHeight(map, value.x, value.y);
    if (!result.ok) {
      setGroundNote(result.error.message);
      return;
    }
    if ('z' in result.value) {
      setGroundNote(null);
      onChange({ ...value, z: result.value.z });
    } else {
      setGroundNote(result.value.reason);
    }
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
        {map !== undefined && (
          <button type="button" className="btn position-input__snap" onClick={() => void snap()}>
            Snap to ground
          </button>
        )}
        {markerId && world && (
          <button type="button" className="entry-card__btn position-input__map" onClick={() => world({ kind: 'marker', id: markerId })}>
            Show in World
          </button>
        )}
        {onShowInWorld && (
          <button type="button" className="entry-card__btn position-input__map" onClick={onShowInWorld}>
            Show in World
          </button>
        )}
      </div>
      {groundNote && <p className="scene-hint">{groundNote}</p>}
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

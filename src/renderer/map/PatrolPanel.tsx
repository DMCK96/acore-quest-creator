import type { Pace, Patrol } from '@core/entities/model';
import { clearRoute, removePoint, setStartPace, updatePoint } from '@core/map/patrol';
import { NumberField, SelectField } from '../scripts/fields';

const START_PACES = [['walk', 'Walking'], ['run', 'Running']] as const;
const PACES_FROM_HERE = [['keep', 'Keep pace'], ['walk', 'Walk from here'], ['run', 'Run from here']] as const;

const degrees = (radians: number): number => Math.round((radians * 180) / Math.PI) % 360;

/** The side panel while a new NPC's patrol is drawn: its points, and what the selected one does. */
export function PatrolPanel({
  name,
  patrol,
  selected,
  picking,
  onSelect,
  onChange,
  onDone,
  onPickFacing,
  children,
}: {
  name: string;
  patrol: Patrol;
  selected: number | null;
  picking: 'facing' | 'object' | null;
  onSelect(index: number | null): void;
  onChange(next: Patrol): void;
  onDone(): void;
  onPickFacing(index: number): void;
  /** What the selected point does, drawn under its settings. */
  children?: React.ReactNode;
}): React.JSX.Element {
  const point = selected === null ? undefined : patrol.points[selected];
  return (
    <section aria-label="Patrol" className="quest-map__patrol">
      <h3>Patrol: {name}</h3>
      <p className="scene-hint">Click the map to add a point. Right-click a point for what it does there.</p>
      {picking === 'facing' && <p className="scene-warning">Click where it should look.</p>}
      {picking === 'object' && <p className="scene-warning">Click an object on the map.</p>}
      <SelectField label="Starts" value={patrol.startPace} options={START_PACES} onChange={(pace: Pace) => onChange(setStartPace(patrol, pace))} />
      <div className="quest-map__points">
        {patrol.points.map((_, i) => (
          <button key={i} type="button" aria-pressed={i === selected}
            className={`entry-card__btn${i === selected ? ' quest-map__item--selected' : ''}`} onClick={() => onSelect(i)}>
            Point {i + 1}
          </button>
        ))}
      </div>
      {point && selected !== null && (
        <section aria-label={`Point ${selected + 1}`} className="quest-map__point">
          <NumberField label="Wait (seconds)" value={point.waitSecs} min={0}
            onChange={(waitSecs) => onChange(updatePoint(patrol, selected, { waitSecs: Math.max(0, waitSecs) }))} />
          <SelectField label="Pace from here" value={point.paceFromHere ?? 'keep'} options={PACES_FROM_HERE}
            onChange={(v) => onChange(updatePoint(patrol, selected, { paceFromHere: v === 'keep' ? null : v }))} />
          {point.facing === null ? (
            <button type="button" className="entry-card__btn" onClick={() => onPickFacing(selected)}>
              Set facing
            </button>
          ) : (
            <p className="scene-hint">
              Facing {degrees(point.facing)}°{' '}
              <button type="button" className="entry-card__btn" onClick={() => onChange(updatePoint(patrol, selected, { facing: null }))}>
                Clear
              </button>
            </p>
          )}
          {children}
          <button type="button" className="entry-card__btn entry-card__btn--danger"
            onClick={() => {
              onChange(removePoint(patrol, selected));
              onSelect(null);
            }}>
            Remove point
          </button>
        </section>
      )}
      <div className="quest-map__patrol-actions">
        <button type="button" className="btn" onClick={() => onChange(clearRoute(patrol))}>
          Clear route
        </button>
        <button type="button" className="btn btn--primary" onClick={onDone}>
          Done
        </button>
      </div>
    </section>
  );
}

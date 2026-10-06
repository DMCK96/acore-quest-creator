import type { Pace, Patrol } from '@core/entities/model';
import { clearRoute, removePoint, setStartPace } from '@core/map/patrol';
import { PatrolPointFields } from './PatrolPointFields';
import { SelectField } from '../scripts/fields';

const START_PACES = [['walk', 'Walking'], ['run', 'Running']] as const;

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
  onPickObject,
}: {
  name: string;
  patrol: Patrol;
  selected: number | null;
  picking: 'facing' | 'object' | null;
  onSelect(index: number | null): void;
  onChange(next: Patrol): void;
  onDone(): void;
  onPickFacing(index: number): void;
  /** Starts picking the object a `useObject` action at a point uses. */
  onPickObject(index: number): void;
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
          <PatrolPointFields idPrefix={`patrol-${selected}`} patrol={patrol} index={selected} onChange={onChange} onPickFacing={onPickFacing} onPickObject={onPickObject} />
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

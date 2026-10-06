import type { Patrol } from '@core/entities/model';
import { addAction, moveAction, newAction, removeAction, updateAction, updatePoint, type NewPointAction } from '@core/map/patrol';
import { PointActionForm } from './PointActionForm';
import { NumberField, SelectField } from '../scripts/fields';

const PACES_FROM_HERE = [['keep', 'Keep pace'], ['walk', 'Walk from here'], ['run', 'Run from here']] as const;
const NEW_ACTIONS: readonly (readonly [NewPointAction | '', string])[] = [
  ['', 'Add an action…'], ['say', 'Say something'], ['emote', 'Play an emote'], ['pose', 'Hold a pose while waiting'],
  ['cast', 'Cast a spell'], ['sound', 'Play a sound'], ['mount', 'Mount'], ['dismount', 'Dismount'],
];

const degrees = (radians: number): number => Math.round((radians * 180) / Math.PI) % 360;
const radians = (degrees: number): number => ((((degrees % 360) + 360) % 360) * Math.PI) / 180;

/**
 * What one point of a project NPC's patrol does: how long it waits, its pace from there, the way it
 * faces, and its actions. The quest map picks the facing and an object to use by clicking the map; a
 * view that cannot leaves them out, and the facing is typed in degrees instead.
 */
export function PatrolPointFields({
  idPrefix,
  patrol,
  index,
  onChange,
  onPickFacing,
  onPickObject,
  canAdd = false,
}: {
  idPrefix: string;
  patrol: Patrol;
  index: number;
  onChange(next: Patrol): void;
  onPickFacing?(index: number): void;
  onPickObject?(index: number): void;
  /** Offers to add an action here (the quest map adds them from its point menu instead) */
  canAdd?: boolean;
}): React.JSX.Element | null {
  const point = patrol.points[index];
  if (!point) return null;
  return (
    <>
      <NumberField label="Wait (seconds)" value={point.waitSecs} min={0}
        onChange={(waitSecs) => onChange(updatePoint(patrol, index, { waitSecs: Math.max(0, waitSecs) }))} />
      <SelectField label="Pace from here" value={point.paceFromHere ?? 'keep'} options={PACES_FROM_HERE}
        onChange={(v) => onChange(updatePoint(patrol, index, { paceFromHere: v === 'keep' ? null : v }))} />
      {onPickFacing ? (
        point.facing === null ? (
          <button type="button" className="entry-card__btn" onClick={() => onPickFacing(index)}>
            Set facing
          </button>
        ) : (
          <p className="scene-hint">
            <span>Facing {degrees(point.facing)}°</span>{' '}
            <button type="button" className="entry-card__btn" onClick={() => onChange(updatePoint(patrol, index, { facing: null }))}>
              Clear
            </button>
          </p>
        )
      ) : (
        <FacingField facing={point.facing} onChange={(facing) => onChange(updatePoint(patrol, index, { facing }))} />
      )}
      {point.actions.map((action, k) => (
        <PointActionForm
          key={action.id}
          idPrefix={`${idPrefix}-${action.id}`}
          action={action}
          waitSecs={point.waitSecs}
          first={k === 0}
          last={k === point.actions.length - 1}
          onChange={(next) => onChange(updateAction(patrol, index, next))}
          onMove={(by) => onChange(moveAction(patrol, index, action.id, by))}
          onRemove={() => onChange(removeAction(patrol, index, action.id))}
          onPickObject={onPickObject ? () => onPickObject(index) : undefined}
        />
      ))}
      {canAdd && (
        <SelectField label="Actions" value="" options={NEW_ACTIONS}
          onChange={(kind) => {
            if (kind) onChange(addAction(patrol, index, newAction(point, kind)));
          }} />
      )}
    </>
  );
}

/** The way something faces while it waits, in degrees; empty for none */
export function FacingField({ facing, onChange }: { facing: number | null; onChange(next: number | null): void }): React.JSX.Element {
  return (
    <p className="scene-hint">
      {facing === null ? (
        <button type="button" className="entry-card__btn" onClick={() => onChange(0)}>
          Set facing
        </button>
      ) : (
        <>
          <NumberField label="Facing (degrees)" value={degrees(facing)} onChange={(d) => onChange(radians(d))} />{' '}
          <button type="button" className="entry-card__btn" onClick={() => onChange(null)}>
            Clear
          </button>
        </>
      )}
    </p>
  );
}

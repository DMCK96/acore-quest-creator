import type { PointAction, SayLine } from '@core/entities/model';
import { POSES } from '@core/patrol/poses';
import { EMOTES } from '../controls/game-data';
import { EntityPicker } from '../controls/EntityPicker';
import { SpellField } from '../combat/SpellField';
import { NumberField, SelectField, TextField } from '../scripts/fields';
import { useName } from '../state/names';

const ONE_SHOT = ' (one-shot)';
const EMOTE_OPTIONS = EMOTES.filter((e) => e.label.endsWith(ONE_SHOT)).map((e) => [String(e.value), e.label.slice(0, -ONE_SHOT.length)] as const);
const POSE_OPTIONS = POSES.map((p) => [String(p.value), p.label] as const);
const STYLES = [['say', 'Say'], ['yell', 'Yell'], ['emote', 'Emote']] as const;

const TITLES: Record<PointAction['kind'], string> = {
  say: 'Says',
  emote: 'Plays an emote',
  pose: 'Holds a pose',
  cast: 'Casts a spell',
  sound: 'Plays a sound',
  mount: 'Mounts',
  dismount: 'Dismounts',
  useObject: 'Uses an object',
};

/** Keeps a select showing a value that is not in its list, rather than silently showing another. */
function withValue(options: readonly (readonly [string, string])[], value: string): readonly (readonly [string, string])[] {
  return options.some(([v]) => v === value) ? options : [...options, [value, `#${value}`] as const];
}

function ObjectName({ guid, entry }: { guid: number; entry: number }): React.JSX.Element {
  const { name } = useName('gameobject', entry);
  return <p className="scene-hint">Uses {name ?? `object #${entry}`} (spawn {guid}).</p>;
}

/** One thing a patrolling NPC does at a point: its own fields, when it happens, and its order. */
export function PointActionForm({
  idPrefix,
  action,
  first,
  last,
  onChange,
  onMove,
  onRemove,
  onPickObject,
  waitSecs,
}: {
  idPrefix: string;
  action: PointAction;
  /** How long the NPC waits at the point; an action due later may be cut off when it walks on. */
  waitSecs: number;
  first: boolean;
  last: boolean;
  onChange(next: PointAction): void;
  onMove(by: -1 | 1): void;
  onRemove(): void;
  onPickObject(): void;
}): React.JSX.Element {
  function fields(): React.ReactNode {
    switch (action.kind) {
      case 'say': {
        const setLine = (i: number, line: SayLine): void => onChange({ ...action, lines: action.lines.map((l, j) => (j === i ? line : l)) });
        return (
          <>
            {action.lines.map((line, i) => (
              <div key={i} className="scene-row">
                <TextField label={`Line ${i + 1}`} value={line.text} onChange={(t) => setLine(i, { ...line, text: t })} />
                <SelectField label={`Style ${i + 1}`} value={line.style} options={STYLES} onChange={(style) => setLine(i, { ...line, style })} />
                {action.lines.length > 1 && (
                  <button type="button" className="entry-card__btn" onClick={() => onChange({ ...action, lines: action.lines.filter((_, j) => j !== i) })}>
                    Remove line {i + 1}
                  </button>
                )}
              </div>
            ))}
            <button type="button" className="entry-card__btn" onClick={() => onChange({ ...action, lines: [...action.lines, { text: '', style: 'say' }] })}>
              Add line
            </button>
            <NumberField label="Chance (%)" value={action.chance} min={0}
              onChange={(chance) => onChange({ ...action, chance: Math.min(100, Math.max(0, chance)) })} />
            {action.lines.length > 1 && <p className="scene-hint">One of the lines is picked at random each time.</p>}
          </>
        );
      }
      case 'emote':
        return <SelectField label="Emote" value={String(action.emote)} options={withValue(EMOTE_OPTIONS, String(action.emote))}
          onChange={(v) => onChange({ ...action, emote: Number(v) })} />;
      case 'pose':
        return <SelectField label="Pose" value={String(action.emoteState)} options={withValue(POSE_OPTIONS, String(action.emoteState))}
          onChange={(v) => onChange({ ...action, emoteState: Number(v) })} />;
      case 'cast':
        return <SpellField id={`${idPrefix}-spell`} label="Spell" value={action.spell} onChange={(spell) => onChange({ ...action, spell })} />;
      case 'sound':
        return <EntityPicker id={`${idPrefix}-sound`} label="Sound" kind="sound" value={action.sound} onChange={(sound) => onChange({ ...action, sound })} />;
      case 'mount':
        return <EntityPicker id={`${idPrefix}-ride`} label="Ride" kind="creature" value={action.creature} onChange={(creature) => onChange({ ...action, creature })} />;
      case 'dismount':
        return <p className="scene-hint">Gets off its mount here.</p>;
      case 'useObject':
        return (
          <>
            <ObjectName guid={action.guid} entry={action.entry} />
            <button type="button" className="entry-card__btn" onClick={onPickObject}>
              Pick another
            </button>
          </>
        );
    }
  }

  return (
    <fieldset aria-label={TITLES[action.kind]} className="quest-map__action">
      <legend>{TITLES[action.kind]}</legend>
      {fields()}
      {action.afterSecs > waitSecs && (
        <p className="scene-hint">It only waits {waitSecs} s here, so this may be cut short when it walks on.</p>
      )}
      <div className="scene-row">
        <NumberField label="After (seconds)" value={action.afterSecs} min={0}
          onChange={(afterSecs) => onChange({ ...action, afterSecs: Math.max(0, afterSecs) })} />
        <button type="button" className="entry-card__btn" disabled={first} onClick={() => onMove(-1)}>
          Up
        </button>
        <button type="button" className="entry-card__btn" disabled={last} onClick={() => onMove(1)}>
          Down
        </button>
        <button type="button" className="entry-card__btn entry-card__btn--danger" onClick={onRemove}>
          Remove
        </button>
      </div>
    </fieldset>
  );
}

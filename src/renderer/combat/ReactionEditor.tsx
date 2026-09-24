import { PHASED_WHEN, type Fight, type FightStep, type FightStepKind, type Reaction, type ReactionKind, type ReactionWhen } from '@core/combat/model';
import type { SceneStep } from '@core/scripts/model';
import { PositionInput } from '../scripts/PositionInput';
import { defaultStep, StepFields } from '../scripts/StepEditor';
import { CheckField, EntityField, NumberField, SelectField } from '../scripts/fields';
import { TARGET_OPTIONS } from './AbilityEditor';
import { PhaseChecks } from './PhaseList';
import { SpellField } from './SpellField';

export const WHEN_LABELS: Record<ReactionKind, string> = {
  aggro: 'When it enters combat',
  healthBelow: 'At a health %',
  friendHealthBelow: 'When a friend is hurt',
  addDies: 'When one of its adds dies',
  kill: 'When it kills a player',
  death: 'When it dies',
  evade: 'When it gives up and resets',
};

const STEP_LABELS: Record<FightStepKind, string> = {
  say: 'Say or yell',
  emote: 'Emote',
  cast: 'Cast a spell',
  summonAdds: 'Summon adds',
  despawnAdds: 'Despawn its adds',
  goToPhase: 'Go to phase',
  flee: 'Flee for help',
  callForHelp: 'Call for help',
  holdAtHealth: 'Stop taking damage at',
  surrender: 'Surrender',
  credit: 'Give quest credit',
};

export function defaultWhen(kind: ReactionKind): ReactionWhen {
  switch (kind) {
    case 'healthBelow':
      return { kind, pct: 50 };
    case 'friendHealthBelow':
      return { kind, pct: 40, range: 30 };
    case 'addDies':
      return { kind, entry: 0 };
    default:
      return { kind };
  }
}

/** A new step of a kind; `phase` is the phase a new "Go to phase" step moves to. */
function newStep(kind: FightStepKind, phase: number): FightStep {
  switch (kind) {
    case 'say':
    case 'emote':
    case 'credit':
      return { ...(defaultStep(kind) as FightStep), waitMs: 0 };
    case 'cast':
      return { kind, spellId: 0, target: 'victim', waitMs: 0 };
    case 'summonAdds':
      return { kind, entry: 0, count: 1, at: 'aroundMe', attack: true, waitMs: 0 };
    case 'despawnAdds':
      return { kind, entry: 0, waitMs: 0 };
    case 'goToPhase':
      return { kind, phase, waitMs: 0 };
    case 'callForHelp':
      return { kind, radius: 20, waitMs: 0 };
    case 'holdAtHealth':
      return { kind, pct: 20, waitMs: 0 };
    case 'flee':
    case 'surrender':
      return { kind, waitMs: 0 };
  }
}

/** One reaction: when it happens, the phases it counts in, and its steps in order. */
export function ReactionEditor({
  idPrefix,
  index,
  reaction,
  fight,
  onChange,
  onRemove,
}: {
  idPrefix: string;
  index: number;
  reaction: Reaction;
  fight: Fight;
  /** `phase`: a phase the fight must have for the change to make sense. */
  onChange(next: Reaction, phase?: number): void;
  onRemove(): void;
}): React.JSX.Element {
  const { when, steps } = reaction;
  const setWhen = (next: ReactionWhen): void => onChange({ ...reaction, when: next, phases: PHASED_WHEN.has(next.kind) ? reaction.phases : [] });
  const setStep = (i: number, step: FightStep): void => onChange({ ...reaction, steps: steps.map((s, j) => (j === i ? step : s)) });
  const move = (i: number, by: -1 | 1): void => {
    const next = [...steps];
    const [taken] = next.splice(i, 1);
    next.splice(i + by, 0, taken!);
    onChange({ ...reaction, steps: next });
  };
  function add(kind: FightStepKind): void {
    const phase = Math.max(2, fight.phases.length + 1);
    onChange({ ...reaction, steps: [...steps, newStep(kind, phase)] }, kind === 'goToPhase' ? phase : undefined);
  }

  return (
    <fieldset className="scene-step fight-item" aria-label={`Reaction ${index + 1}`}>
      <div className="scene-step__head">
        <strong>Reaction {index + 1}</strong>
        <button type="button" className="entry-card__btn entry-card__btn--danger" onClick={onRemove}>
          Remove
        </button>
      </div>
      <SelectField
        label="When"
        value={when.kind}
        options={Object.entries(WHEN_LABELS) as [ReactionKind, string][]}
        onChange={(kind) => setWhen(defaultWhen(kind))}
      />
      {(when.kind === 'healthBelow' || when.kind === 'friendHealthBelow') && (
        <NumberField label="Health %" value={when.pct} min={1} onChange={(pct) => setWhen({ ...when, pct })} />
      )}
      {when.kind === 'friendHealthBelow' && <NumberField label="Within yd" value={when.range} min={1} onChange={(range) => setWhen({ ...when, range })} />}
      {when.kind === 'addDies' && (
        <EntityField id={`${idPrefix}-add`} label="Add (any if empty)" kind="creature" value={when.entry} onChange={(entry) => setWhen({ ...when, entry })} />
      )}
      {fight.phases.length > 0 && PHASED_WHEN.has(when.kind) && (
        <PhaseChecks fight={fight} value={reaction.phases} onChange={(phases) => onChange({ ...reaction, phases })} />
      )}
      <div className="scene-section">
        <h4 className="scene-section__title">Then</h4>
        {steps.length === 0 && <p className="scene-hint">Nothing happens yet. Add a step.</p>}
        <ol className="scene-steps">
          {steps.map((step, i) => (
            <li key={i} className="scene-step">
              <div className="scene-step__head">
                <strong>{STEP_LABELS[step.kind]}</strong>
                <span className="entry-card__actions">
                  <button type="button" className="entry-card__btn" disabled={i === 0} onClick={() => move(i, -1)}>
                    Up
                  </button>
                  <button type="button" className="entry-card__btn" disabled={i === steps.length - 1} onClick={() => move(i, 1)}>
                    Down
                  </button>
                  <button
                    type="button"
                    className="entry-card__btn entry-card__btn--danger"
                    onClick={() => onChange({ ...reaction, steps: steps.filter((_, j) => j !== i) })}
                  >
                    Remove
                  </button>
                </span>
              </div>
              <NumberField
                label={i === 0 ? 'Wait first (seconds)' : 'Wait after the step before (seconds)'}
                value={step.waitMs / 1000}
                min={0}
                onChange={(seconds) => setStep(i, { ...step, waitMs: Math.max(0, Math.round(seconds * 1000)) })}
              />
              <FightStepFields idPrefix={`${idPrefix}-s${i}`} step={step} fight={fight} reaction={reaction} onChange={(next) => setStep(i, next)} />
            </li>
          ))}
        </ol>
        <label className="scene-field">
          <span>Add step</span>
          <select
            aria-label="Add step"
            value=""
            onChange={(e) => {
              if (e.target.value) add(e.target.value as FightStepKind);
            }}
          >
            <option value="">Choose a step to add…</option>
            {(Object.keys(STEP_LABELS) as FightStepKind[]).map((k) => (
              <option key={k} value={k}>
                {STEP_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
      </div>
    </fieldset>
  );
}

function FightStepFields({
  idPrefix,
  step,
  fight,
  reaction,
  onChange,
}: {
  idPrefix: string;
  step: FightStep;
  fight: Fight;
  reaction: Reaction;
  onChange(next: FightStep): void;
}): React.JSX.Element | null {
  switch (step.kind) {
    case 'say':
    case 'emote':
    case 'credit':
      // The same fields as the scene steps of these kinds.
      return <StepFields idPrefix={idPrefix} step={step as SceneStep} onChange={(next) => onChange(next as FightStep)} />;
    case 'cast': {
      const targets = reaction.when.kind === 'friendHealthBelow' ? [...TARGET_OPTIONS, ['hurtFriend', 'The hurt friend'] as const] : TARGET_OPTIONS;
      return (
        <>
          <SpellField
            id={`${idPrefix}-spell`}
            label="Spell"
            value={step.spellId}
            onChange={(spellId, facts) => onChange({ ...step, spellId, target: facts?.kind === 'helpful' ? 'self' : facts?.kind === 'harmful' ? 'victim' : step.target })}
          />
          <SelectField label="Cast on" value={step.target} options={targets} onChange={(target) => onChange({ ...step, target })} />
        </>
      );
    }
    case 'summonAdds':
      return (
        <>
          <EntityField id={`${idPrefix}-npc`} label="NPC" kind="creature" value={step.entry} onChange={(entry) => onChange({ ...step, entry })} />
          <NumberField label="How many" value={step.count} min={1} onChange={(count) => onChange({ ...step, count: Math.max(1, Math.round(count)) })} />
          <SelectField
            label="Where"
            value={step.at === 'aroundMe' ? 'aroundMe' : 'point'}
            options={[['aroundMe', 'Around itself'], ['point', 'At a point']] as const}
            onChange={(where) => onChange({ ...step, at: where === 'aroundMe' ? 'aroundMe' : { x: 0, y: 0, z: 0, o: 0 } })}
          />
          {step.at !== 'aroundMe' && <PositionInput idPrefix={`${idPrefix}-at`} value={step.at} onChange={(at) => onChange({ ...step, at })} />}
          <CheckField label="Attack right away" value={step.attack} onChange={(attack) => onChange({ ...step, attack })} />
        </>
      );
    case 'despawnAdds':
      return <EntityField id={`${idPrefix}-npc`} label="Only NPC (all if empty)" kind="creature" value={step.entry} onChange={(entry) => onChange({ ...step, entry })} />;
    case 'goToPhase':
      return (
        <SelectField
          label="Phase"
          value={String(step.phase)}
          options={fight.phases.map((name, i) => [String(i + 1), `${i + 1}: ${name}`] as const)}
          onChange={(p) => onChange({ ...step, phase: Number(p) })}
        />
      );
    case 'callForHelp':
      return <NumberField label="Within yd" value={step.radius} min={1} onChange={(radius) => onChange({ ...step, radius })} />;
    case 'holdAtHealth':
      return <NumberField label="Health %" value={step.pct} min={1} onChange={(pct) => onChange({ ...step, pct })} />;
    case 'flee':
    case 'surrender':
      return null;
  }
}

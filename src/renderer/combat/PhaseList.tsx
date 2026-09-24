import { useState } from 'react';
import { phaseUses, removePhase, type Fight } from '@core/combat/model';
import { TextField } from '../scripts/fields';

/** The fight's phases by name. A phase still in use cannot be removed; the list says where it is used. */
export function PhaseList({ fight, onChange }: { fight: Fight; onChange(next: Fight): void }): React.JSX.Element {
  const [blocked, setBlocked] = useState<string | null>(null);

  const itemName = (id: string): string => {
    const ability = fight.abilities.findIndex((a) => a.id === id);
    if (ability >= 0) return `Ability ${ability + 1}`;
    return `Reaction ${fight.reactions.findIndex((r) => r.id === id) + 1}`;
  };

  function remove(phase: number): void {
    const next = removePhase(fight, phase);
    const name = fight.phases[phase - 1]!;
    if (next === null) {
      setBlocked(`${name} is still used by ${phaseUses(fight, phase).map(itemName).join(', ')}.`);
      return;
    }
    setBlocked(null);
    onChange(next);
  }

  return (
    <fieldset className="scene-section fight-phases" aria-label="Phases">
      <h4 className="scene-section__title">Phases</h4>
      <p className="scene-hint">The fight starts in phase 1; reactions move it on.</p>
      <ol className="scene-steps">
        {fight.phases.map((name, i) => (
          <li key={i} className="scene-step fight-phase">
            <TextField
              label={`Phase ${i + 1} name`}
              value={name}
              onChange={(text) => onChange({ ...fight, phases: fight.phases.map((p, j) => (j === i ? text : p)) })}
            />
            <button type="button" className="entry-card__btn entry-card__btn--danger" onClick={() => remove(i + 1)}>
              Remove {name}
            </button>
          </li>
        ))}
      </ol>
      {blocked && <p className="scene-warning">{blocked}</p>}
    </fieldset>
  );
}

/** Checkboxes for the phases an ability or reaction runs in; none ticked means every phase. */
export function PhaseChecks({ fight, value, onChange }: { fight: Fight; value: readonly number[]; onChange(next: number[]): void }): React.JSX.Element {
  const toggle = (phase: number, on: boolean): void =>
    onChange((on ? [...value, phase] : value.filter((p) => p !== phase)).sort((a, b) => a - b));
  return (
    <div className="scene-field fight-phase-checks">
      <span>In phases</span>
      <span className="fight-phase-checks__list">
        {fight.phases.map((name, i) => (
          <label key={i} className="scene-field--check">
            <input type="checkbox" checked={value.includes(i + 1)} onChange={(e) => toggle(i + 1, e.target.checked)} />
            <span>{name}</span>
          </label>
        ))}
      </span>
      {value.length === 0 && <span className="scene-hint">None ticked: every phase.</span>}
    </div>
  );
}

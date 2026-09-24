import { useEffect, useMemo, useState } from 'react';
import { describeFight } from '@core/combat/describe';
import { emptyFight, fightIsEmpty, newAbility, newReaction, withPhase, type Fight, type ReactionKind } from '@core/combat/model';
import { applyPreset, PRESETS, type PresetId } from '@core/combat/presets';
import { useApi } from '../state/names';
import { AbilityEditor } from './AbilityEditor';
import { PhaseList } from './PhaseList';
import { defaultWhen, ReactionEditor, WHEN_LABELS } from './ReactionEditor';
import './combat.css';

/** A select that does something when an option is chosen and goes back to its placeholder. */
function ChooseSelect<T extends string>({ label, placeholder, options, onChoose }: { label: string; placeholder: string; options: readonly (readonly [T, string])[]; onChoose(v: T): void }): React.JSX.Element {
  return (
    <label className="scene-field">
      <span>{label}</span>
      <select aria-label={label} value="" onChange={(e) => e.target.value && onChoose(e.target.value as T)}>
        <option value="">{placeholder}</option>
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

const PRESET_OPTIONS = PRESETS.map((p) => [p.id, p.label] as const);
const REACTION_OPTIONS = Object.entries(WHEN_LABELS) as [ReactionKind, string][];

/** Every spell id a fight names, for looking their names up once. */
function spellIds(fight: Fight | null): number[] {
  if (!fight) return [];
  const ids = [...fight.abilities.map((a) => a.spellId), ...fight.reactions.flatMap((r) => r.steps.flatMap((s) => (s.kind === 'cast' ? [s.spellId] : [])))];
  return [...new Set(ids.filter((id) => id > 0))].sort((a, b) => a - b);
}

/** A new NPC's fight: a plain-English summary, then its phases, abilities and reactions. */
export function FightEditor({ idPrefix, entry, fight, onChange }: { idPrefix: string; entry?: number; fight: Fight | null; onChange(next: Fight | null): void }): React.JSX.Element {
  const api = useApi();
  const ids = spellIds(fight);
  const idsKey = ids.join(',');
  const [names, setNames] = useState<Record<number, string>>({});

  useEffect(() => {
    if (!api || idsKey === '') return undefined;
    let live = true;
    void api.spellFacts(idsKey.split(',').map(Number)).then((result) => {
      if (!live || !result.ok) return;
      setNames(Object.fromEntries(Object.values(result.value.spells).map((s) => [s.id, s.name])));
    });
    return () => {
      live = false;
    };
  }, [api, idsKey]);

  const lines = useMemo(() => (fight ? describeFight(fight, (id) => names[id]) : []), [fight, names]);
  const preset = (id: PresetId): void => onChange(applyPreset(fight, id));

  if (fight === null || (fightIsEmpty(fight) && fight.phases.length === 0)) {
    return (
      <section className="scene-section fight" aria-label="Fight">
        <h4 className="scene-section__title">Fight</h4>
        <p className="scene-hint">This NPC just attacks (no abilities).</p>
        <div className="fight__start">
          <button type="button" className="btn" onClick={() => onChange({ ...emptyFight(), abilities: [newAbility(emptyFight())] })}>
            Give it a fight
          </button>
          <ChooseSelect label="Start from a preset" placeholder="Choose a preset…" options={PRESET_OPTIONS} onChoose={preset} />
        </div>
      </section>
    );
  }

  const setAbilities = (abilities: Fight['abilities']): void => onChange({ ...fight, abilities });
  const moveAbility = (i: number, by: -1 | 1): void => {
    const next = [...fight.abilities];
    const [taken] = next.splice(i, 1);
    next.splice(i + by, 0, taken!);
    setAbilities(next);
  };

  return (
    <section className="scene-section fight" aria-label="Fight">
      <h4 className="scene-section__title">Fight</h4>
      <ul className="fight__summary">
        {lines.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
      {fight.phases.length > 0 && <PhaseList fight={fight} onChange={onChange} />}

      <div className="scene-section">
        <h4 className="scene-section__title">Abilities</h4>
        {fight.abilities.map((ability, i) => (
          <AbilityEditor
            key={ability.id}
            idPrefix={`${idPrefix}-${ability.id}`}
            index={i}
            count={fight.abilities.length}
            ability={ability}
            fight={fight}
            onChange={(next) => setAbilities(fight.abilities.map((a, j) => (j === i ? next : a)))}
            onMove={(by) => moveAbility(i, by)}
            onRemove={() => setAbilities(fight.abilities.filter((_, j) => j !== i))}
          />
        ))}
        <button type="button" className="btn" onClick={() => setAbilities([...fight.abilities, newAbility(fight)])}>
          Add ability
        </button>
      </div>

      <div className="scene-section">
        <h4 className="scene-section__title">Reactions</h4>
        {fight.reactions.map((reaction, i) => (
          <ReactionEditor
            key={reaction.id}
            idPrefix={`${idPrefix}-${reaction.id}`}
            markerBase={entry === undefined ? undefined : `fight:${entry}:${reaction.id}`}
            index={i}
            reaction={reaction}
            fight={fight}
            onChange={(next, phase) => {
              const updated = { ...fight, reactions: fight.reactions.map((r, j) => (j === i ? next : r)) };
              onChange(phase === undefined ? updated : withPhase(updated, phase));
            }}
            onRemove={() => onChange({ ...fight, reactions: fight.reactions.filter((_, j) => j !== i) })}
          />
        ))}
        <ChooseSelect
          label="Add reaction"
          placeholder="Choose when it reacts…"
          options={REACTION_OPTIONS}
          onChoose={(kind) => onChange({ ...fight, reactions: [...fight.reactions, newReaction(fight, defaultWhen(kind))] })}
        />
      </div>

      <div className="fight__start">
        <ChooseSelect label="Add from a preset" placeholder="Choose a preset…" options={PRESET_OPTIONS} onChoose={preset} />
        <button type="button" className="entry-card__btn entry-card__btn--danger" onClick={() => onChange(null)}>
          Remove fight
        </button>
      </div>
    </section>
  );
}

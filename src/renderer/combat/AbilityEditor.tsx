import { ABILITY_TARGETS, type Ability, type AbilityTarget, type Fight } from '@core/combat/model';
import { TARGET_WORDS } from '@core/combat/describe';
import { CheckField, NumberField, SelectField } from '../scripts/fields';
import { PhaseChecks } from './PhaseList';
import { SpellField } from './SpellField';

const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
export const TARGET_OPTIONS: readonly (readonly [AbilityTarget, string])[] = ABILITY_TARGETS.map((t) => [t, capital(TARGET_WORDS[t])] as const);

/** One ability: a spell cast on a timer at a target, with its options. */
export function AbilityEditor({
  idPrefix,
  index,
  count,
  ability,
  fight,
  onChange,
  onMove,
  onRemove,
}: {
  idPrefix: string;
  index: number;
  count: number;
  ability: Ability;
  fight: Fight;
  onChange(next: Ability): void;
  onMove(by: -1 | 1): void;
  onRemove(): void;
}): React.JSX.Element {
  const once = ability.repeatMinS === 0 && ability.repeatMaxS === 0;
  const set = (over: Partial<Ability>): void => onChange({ ...ability, ...over });
  return (
    <fieldset className="scene-step fight-item" aria-label={`Ability ${index + 1}`}>
      <div className="scene-step__head">
        <strong>Ability {index + 1}</strong>
        <span className="entry-card__actions">
          <button type="button" className="entry-card__btn" disabled={index === 0} onClick={() => onMove(-1)}>
            Up
          </button>
          <button type="button" className="entry-card__btn" disabled={index === count - 1} onClick={() => onMove(1)}>
            Down
          </button>
          <button type="button" className="entry-card__btn entry-card__btn--danger" onClick={onRemove}>
            Remove
          </button>
        </span>
      </div>
      <SpellField
        id={`${idPrefix}-spell`}
        label="Spell"
        value={ability.spellId}
        onChange={(spellId, facts) =>
          set({ spellId, target: facts?.kind === 'helpful' ? 'self' : facts?.kind === 'harmful' ? 'victim' : ability.target })
        }
      />
      <SelectField label="Cast on" value={ability.target} options={TARGET_OPTIONS} onChange={(target) => set({ target })} />
      <div className="scene-row">
        <NumberField label="First after (from s)" value={ability.firstMinS} min={0} onChange={(firstMinS) => set({ firstMinS })} />
        <NumberField label="First after (to s)" value={ability.firstMaxS} min={0} onChange={(firstMaxS) => set({ firstMaxS })} />
      </div>
      <CheckField label="Only once" value={once} onChange={(on) => set(on ? { repeatMinS: 0, repeatMaxS: 0 } : { repeatMinS: 8, repeatMaxS: 12 })} />
      {!once && (
        <div className="scene-row">
          <NumberField label="Then every (from s)" value={ability.repeatMinS} min={0} onChange={(repeatMinS) => set({ repeatMinS })} />
          <NumberField label="Then every (to s)" value={ability.repeatMaxS} min={0} onChange={(repeatMaxS) => set({ repeatMaxS })} />
        </div>
      )}
      <CheckField label="Stays at range while it can cast this" value={ability.keepDistance} onChange={(keepDistance) => set({ keepDistance })} />
      <CheckField label="Don't recast while it is still on them" value={ability.skipIfAuraPresent} onChange={(skipIfAuraPresent) => set({ skipIfAuraPresent })} />
      {fight.phases.length > 0 && <PhaseChecks fight={fight} value={ability.phases} onChange={(phases) => set({ phases })} />}
    </fieldset>
  );
}

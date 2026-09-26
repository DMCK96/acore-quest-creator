import type { CustomItem, ItemSpell } from '@core/entities/model';
import { SPELL_TRIGGERS } from '@core/entities/item-vocab';
import { EntityField, NumberField } from '../../scripts/fields';
import { NumberSelect } from './NumberSelect';

const MAX_SPELLS = 5;
/** -1 cooldowns use the spell's own, as AzerothCore's defaults do. */
const NEW_SPELL: ItemSpell = { spell: 0, trigger: 0, charges: 0, cooldownMs: -1, category: 0, categoryCooldownMs: -1 };

/** The spells the item casts when used, worn or on a hit. */
export function ItemSpells({ item, onChange }: { item: CustomItem; onChange(next: CustomItem): void }): React.JSX.Element {
  const setSpell = (i: number, spell: ItemSpell): void => onChange({ ...item, spells: item.spells.map((s, j) => (j === i ? spell : s)) });
  return (
    <div className="scripts-body">
      {item.spells.length === 0 && <p className="scene-hint">No spells. Add one for an item that is used, or gives an effect while worn.</p>}
      {item.spells.map((spell, i) => (
        <div key={i} className="scene-section" aria-label={`Spell ${i + 1}`}>
          <EntityField id={`item-${item.entry}-spell-${i}`} label="Spell" kind="spell" value={spell.spell} onChange={(id) => setSpell(i, { ...spell, spell: id })} />
          <NumberSelect label="When" value={spell.trigger} options={SPELL_TRIGGERS} onChange={(trigger) => setSpell(i, { ...spell, trigger })} />
          <NumberField label="Charges (0 = unlimited)" value={spell.charges} onChange={(charges) => setSpell(i, { ...spell, charges })} />
          <NumberField label="Cooldown (ms, -1 = the spell's own)" value={spell.cooldownMs} onChange={(cooldownMs) => setSpell(i, { ...spell, cooldownMs })} />
          <NumberField label="Cooldown category" value={spell.category} min={0} onChange={(category) => setSpell(i, { ...spell, category })} />
          <NumberField label="Category cooldown (ms, -1 = the spell's own)" value={spell.categoryCooldownMs}
            onChange={(categoryCooldownMs) => setSpell(i, { ...spell, categoryCooldownMs })} />
          <button type="button" className="entry-card__btn" onClick={() => onChange({ ...item, spells: item.spells.filter((_, j) => j !== i) })}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" className="btn" disabled={item.spells.length >= MAX_SPELLS} onClick={() => onChange({ ...item, spells: [...item.spells, NEW_SPELL] })}>
        Add spell
      </button>
    </div>
  );
}

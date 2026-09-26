import { useState } from 'react';
import type { CustomItem, ItemDamage, ItemStat } from '@core/entities/model';
import { DAMAGE_SCHOOLS, STAT_TYPES } from '@core/entities/item-vocab';
import { NumberField } from '../../scripts/fields';
import { NumberSelect } from './NumberSelect';

/** Consumables, trade goods and quest items are never worn, so their gear fields start hidden. */
const NOT_GEAR: ReadonlySet<number> = new Set([0, 7, 12]);
const MAX_STATS = 10;
const MAX_DAMAGE = 2;

/** Armor, weapon damage and speed, and stats: what a reward is worn for. */
export function ItemGear({ item, onChange }: { item: CustomItem; onChange(next: CustomItem): void }): React.JSX.Element {
  const [revealed, setRevealed] = useState(false);
  const set = (patch: Partial<CustomItem>): void => onChange({ ...item, ...patch });
  if (NOT_GEAR.has(item.itemClass) && !revealed) {
    return (
      <div className="scripts-body">
        <p className="scene-hint">This kind of item is not worn, so it has no armor, damage or stats.</p>
        <button type="button" className="btn" onClick={() => setRevealed(true)}>
          Show gear fields anyway
        </button>
      </div>
    );
  }
  const setStat = (i: number, stat: ItemStat): void => set({ stats: item.stats.map((s, j) => (j === i ? stat : s)) });
  const setDamage = (i: number, dmg: ItemDamage): void => set({ damage: item.damage.map((d, j) => (j === i ? dmg : d)) });
  return (
    <div className="scripts-body">
      <NumberField label="Armor" value={item.armor} min={0} onChange={(armor) => set({ armor })} />
      <div className="scene-section">
        <h4 className="scene-section__title">Damage</h4>
        {item.damage.map((dmg, i) => (
          <div key={i} className="scene-row" aria-label={`Damage ${i + 1}`}>
            <NumberField label="Least" value={dmg.min} min={0} onChange={(min) => setDamage(i, { ...dmg, min })} />
            <NumberField label="Most" value={dmg.max} min={0} onChange={(max) => setDamage(i, { ...dmg, max })} />
            <NumberSelect label="School" value={dmg.school} options={DAMAGE_SCHOOLS} onChange={(school) => setDamage(i, { ...dmg, school })} />
            <button type="button" className="entry-card__btn" onClick={() => set({ damage: item.damage.filter((_, j) => j !== i) })}>
              Remove
            </button>
          </div>
        ))}
        <button type="button" className="btn" disabled={item.damage.length >= MAX_DAMAGE}
          onClick={() => set({ damage: [...item.damage, { min: 0, max: 0, school: 0 }] })}>
          Add damage
        </button>
        <NumberField label="Weapon speed (ms)" value={item.delayMs} min={0} onChange={(delayMs) => set({ delayMs })} />
      </div>
      <div className="scene-section">
        <h4 className="scene-section__title">Stats</h4>
        {item.stats.map((stat, i) => (
          <div key={i} className="scene-row" aria-label={`Stat ${i + 1}`}>
            <NumberSelect label="Stat" value={stat.type} options={STAT_TYPES} onChange={(type) => setStat(i, { ...stat, type })} />
            <NumberField label="Amount" value={stat.value} onChange={(value) => setStat(i, { ...stat, value })} />
            <button type="button" className="entry-card__btn" onClick={() => set({ stats: item.stats.filter((_, j) => j !== i) })}>
              Remove
            </button>
          </div>
        ))}
        <button type="button" className="btn" disabled={item.stats.length >= MAX_STATS}
          onClick={() => set({ stats: [...item.stats, { type: 7, value: 0 }] })}>
          Add stat
        </button>
      </div>
    </div>
  );
}

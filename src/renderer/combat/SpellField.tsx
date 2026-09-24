import { useEffect, useState } from 'react';
import type { SpellFacts } from '@core/game/spells';
import { EntityPicker } from '../controls/EntityPicker';
import { NumberField } from '../scripts/fields';
import { useApi } from '../state/names';

type Availability = { state: 'loading' } | { state: 'available' } | { state: 'unavailable'; reason: string };

/**
 * A spell, picked by name from the server's spell list. Without a list (no server data folder, or a
 * file that cannot be read) it falls back to typing the ID and says why. A pick reports the spell
 * and its facts in one change, so the caller can save the spell with the target it suggests.
 */
export function SpellField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  onChange(id: number, facts: SpellFacts | null): void;
}): React.JSX.Element {
  const api = useApi();
  const [availability, setAvailability] = useState<Availability>({ state: 'loading' });

  useEffect(() => {
    let live = true;
    if (!api) {
      setAvailability({ state: 'unavailable', reason: 'Spell names need a connection.' });
      return undefined;
    }
    void api.spellFacts([]).then((result) => {
      if (!live) return;
      if (result.ok && result.value.available) setAvailability({ state: 'available' });
      else setAvailability({ state: 'unavailable', reason: result.ok ? (result.value.reason ?? '') : result.error.message });
    });
    return () => {
      live = false;
    };
  }, [api]);

  async function pick(next: number): Promise<void> {
    if (!api || next <= 0) {
      onChange(next, null);
      return;
    }
    const result = await api.spellFacts([next]);
    onChange(next, result.ok ? (result.value.spells[next] ?? null) : null);
  }

  if (availability.state === 'unavailable') {
    return (
      <div className="scene-field scene-field--entity">
        <NumberField label="Spell ID" value={value} min={0} onChange={(n) => onChange(Math.round(n), null)} />
        {availability.reason && <p className="scene-hint">{availability.reason}</p>}
      </div>
    );
  }
  return (
    <div className="scene-field scene-field--entity">
      <EntityPicker id={id} label={label} kind="spell" value={value} onChange={(n) => void pick(n)} />
    </div>
  );
}

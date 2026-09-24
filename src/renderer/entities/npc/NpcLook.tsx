import { useState } from 'react';
import type { CustomNpc } from '@core/entities/model';
import { EntityPicker } from '../../controls/EntityPicker';
import { CheckField, NumberField } from '../../scripts/fields';
import { useApi } from '../../state/names';
import { LookLine } from '../LookLine';

const NO_WEAPONS = { mainHand: 0, offHand: 0, ranged: 0 };

/**
 * How the NPC looks and what it holds. A look is taken from an existing NPC by name, or picked by
 * browsing the server's displays, or typed as an id. Armour is part of the look; only its three
 * weapons are items.
 */
export function NpcLook({ npc, onChange, others = [], hasServerData = true }: {
  npc: CustomNpc;
  hasServerData?: boolean;
  onChange(next: CustomNpc): void;
  /** This quest's other new NPCs: the search offers them, but the database does not have them yet. */
  others?: readonly CustomNpc[];
}): React.JSX.Element {
  const api = useApi();
  const [from, setFrom] = useState(0);
  const [lookError, setLookError] = useState<string | null>(null);
  const [withWeapons, setWithWeapons] = useState(true);
  // Off by default: it would overwrite levels and a faction the author may already have set.
  const [withStats, setWithStats] = useState(false);
  const [otherWays, setOtherWays] = useState(false);

  async function lookLike(entry: number): Promise<void> {
    setFrom(entry);
    setLookError(null);
    if (entry <= 0) return;
    let source: Partial<CustomNpc> | undefined = others.find((o) => o.entry === entry);
    if (!source && api) {
      const result = await api.entityTemplate('creature', entry);
      if (result.ok && result.value && 'displayId' in result.value) source = result.value as Partial<CustomNpc>;
    }
    if (!source) {
      setLookError('Its look could not be read.');
      return;
    }
    onChange({
      ...npc,
      displayId: source.displayId ?? npc.displayId,
      scale: source.scale ?? npc.scale,
      ...(withWeapons ? { equipment: source.equipment ?? NO_WEAPONS } : {}),
      ...(withStats
        ? {
          minLevel: source.minLevel ?? npc.minLevel, maxLevel: source.maxLevel ?? npc.maxLevel, faction: source.faction ?? npc.faction,
          rank: source.rank ?? npc.rank, type: source.type ?? npc.type,
        }
        : {}),
    });
  }

  const weapon = (slot: keyof CustomNpc['equipment'], label: string): React.JSX.Element => (
    <EntityPicker id={`npc-${npc.entry}-${slot}`} label={label} kind="item" value={npc.equipment[slot]}
      onChange={(item) => onChange({ ...npc, equipment: { ...npc.equipment, [slot]: item } })} />
  );

  return (
    <div className="scripts-body">
      <LookLine kind="creatureDisplay" displayId={npc.displayId} hasServerData={hasServerData} />
      <EntityPicker id={`npc-${npc.entry}-look-like`} label="Look like…" kind="creature" value={from} onChange={(entry) => void lookLike(entry)} />
      {lookError && <p className="scene-warning">{lookError}</p>}
      <CheckField label="and its weapons" value={withWeapons} onChange={setWithWeapons} />
      <CheckField label="and its level, faction and rank" value={withStats} onChange={setWithStats} />
      <button type="button" className="entry-card__btn" aria-expanded={otherWays} onClick={() => setOtherWays((v) => !v)}>
        Other ways
      </button>
      {otherWays && (
        <div className="scene-section">
          <EntityPicker id={`npc-${npc.entry}-browse`} label="Browse models" kind="creatureDisplay" value={npc.displayId}
            onChange={(displayId) => onChange({ ...npc, displayId })} />
          <NumberField label="Display ID" value={npc.displayId} min={0} onChange={(displayId) => onChange({ ...npc, displayId: Math.round(displayId) })} />
        </div>
      )}
      <NumberField label="Scale" value={npc.scale} onChange={(scale) => onChange({ ...npc, scale })} />
      <h4 className="scene-section__title">Weapons</h4>
      <p className="scene-hint">Armour comes with the look; only weapons are items.</p>
      {weapon('mainHand', 'Main hand')}
      {weapon('offHand', 'Off hand')}
      {weapon('ranged', 'Ranged')}
    </div>
  );
}

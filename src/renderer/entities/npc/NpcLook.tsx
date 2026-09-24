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
export function NpcLook({ npc, onChange }: { npc: CustomNpc; onChange(next: CustomNpc): void }): React.JSX.Element {
  const api = useApi();
  const [from, setFrom] = useState(0);
  const [withWeapons, setWithWeapons] = useState(true);
  const [otherWays, setOtherWays] = useState(false);

  async function lookLike(entry: number): Promise<void> {
    setFrom(entry);
    if (!api || entry <= 0) return;
    const result = await api.entityTemplate('creature', entry);
    if (!result.ok || !result.value || !('displayId' in result.value)) return;
    const source = result.value as Partial<CustomNpc>;
    onChange({
      ...npc,
      displayId: source.displayId ?? npc.displayId,
      scale: source.scale ?? npc.scale,
      ...(withWeapons ? { equipment: source.equipment ?? NO_WEAPONS } : {}),
    });
  }

  const weapon = (slot: keyof CustomNpc['equipment'], label: string): React.JSX.Element => (
    <EntityPicker id={`npc-${npc.entry}-${slot}`} label={label} kind="item" value={npc.equipment[slot]}
      onChange={(item) => onChange({ ...npc, equipment: { ...npc.equipment, [slot]: item } })} />
  );

  return (
    <div className="scripts-body">
      <LookLine kind="creatureDisplay" displayId={npc.displayId} />
      <EntityPicker id={`npc-${npc.entry}-look-like`} label="Look like…" kind="creature" value={from} onChange={(entry) => void lookLike(entry)} />
      <CheckField label="and its weapons" value={withWeapons} onChange={setWithWeapons} />
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

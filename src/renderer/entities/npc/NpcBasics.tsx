import type { CustomNpc, NpcRank, NpcType } from '@core/entities/model';
import { COMMON_FACTIONS } from '@core/game/faction-templates';
import { EntityPicker } from '../../controls/EntityPicker';
import { CheckField, NumberField, SelectField, TextField } from '../../scripts/fields';

export const RANKS: readonly (readonly [NpcRank, string])[] = [
  ['normal', 'Normal'],
  ['elite', 'Elite'],
  ['rare', 'Rare'],
  ['rareElite', 'Rare elite'],
  ['boss', 'Boss'],
];

export const NPC_TYPES: readonly (readonly [NpcType, string])[] = [
  ['humanoid', 'Humanoid'],
  ['beast', 'Beast'],
  ['critter', 'Critter'],
  ['demon', 'Demon'],
  ['dragonkin', 'Dragonkin'],
  ['elemental', 'Elemental'],
  ['giant', 'Giant'],
  ['mechanical', 'Mechanical'],
  ['undead', 'Undead'],
  ['none', 'Not specified'],
];

/** Who the NPC is: its name and title, levels, side, rank and what it offers players. */
export function NpcBasics({ npc, onChange }: { npc: CustomNpc; onChange(next: CustomNpc): void }): React.JSX.Element {
  return (
    <div className="scripts-body">
      <TextField label="Name" value={npc.name} onChange={(name) => onChange({ ...npc, name })} />
      <TextField label="Title" value={npc.subname} onChange={(subname) => onChange({ ...npc, subname })} />
      <div className="scene-row">
        <NumberField label="Min level" value={npc.minLevel} min={1} onChange={(minLevel) => onChange({ ...npc, minLevel: Math.round(minLevel) })} />
        <NumberField label="Max level" value={npc.maxLevel} min={1} onChange={(maxLevel) => onChange({ ...npc, maxLevel: Math.round(maxLevel) })} />
      </div>
      {/* Every NPC has a faction: clearing the search keeps the one it has. */}
      <EntityPicker id={`npc-${npc.entry}-faction`} label="Faction" kind="factionTemplate" value={npc.faction}
        onChange={(faction) => faction > 0 && onChange({ ...npc, faction })} />
      <div className="scene-row" aria-label="Common factions">
        {COMMON_FACTIONS.map((f) => (
          <button key={f.id} type="button" aria-pressed={npc.faction === f.id}
            className={`entry-card__btn${npc.faction === f.id ? ' quest-map__item--selected' : ''}`} onClick={() => onChange({ ...npc, faction: f.id })}>
            {f.label}
          </button>
        ))}
      </div>
      {/* Without the server data folder there is no faction search, so the id can always be typed. */}
      <NumberField label="Faction ID" value={npc.faction} min={1}
        onChange={(faction) => Math.round(faction) > 0 && onChange({ ...npc, faction: Math.round(faction) })} />
      <div className="scene-row">
        <SelectField label="Rank" value={npc.rank} options={RANKS} onChange={(rank) => onChange({ ...npc, rank })} />
        <SelectField label="Type" value={npc.type} options={NPC_TYPES} onChange={(type) => onChange({ ...npc, type })} />
      </div>
      <CheckField label="Gives quests" value={npc.questGiver} onChange={(questGiver) => onChange({ ...npc, questGiver })} />
      <CheckField label="Can be talked to" value={npc.gossip} onChange={(gossip) => onChange({ ...npc, gossip })} />
    </div>
  );
}

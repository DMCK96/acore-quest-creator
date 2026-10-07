import { SEEN_BY, type CustomNpc, type EventRule, type NpcRank, type NpcType, type SeenBy } from '@core/entities/model';
import { seenByOf } from '@core/entities/visibility';
import type { GameEvent } from '../../controls/EventPicker';
import { EventRuleField } from '../EventRuleField';
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

const SEEN_BY_LABELS: Record<SeenBy, string> = { living: 'Living players', dead: 'Dead players only', both: 'Living and dead players' };
const SEEN_BY_OPTIONS = SEEN_BY.map((s) => [s, SEEN_BY_LABELS[s]] as const);

const everySpawn = (spawns: number): string =>
  spawns === 0 ? 'Applies to every spawn of this NPC.' : `Applies to every spawn of this NPC (${spawns === 1 ? 'its one spawn' : `all ${spawns}`}).`;
const ownEvents = (overrides: number): string =>
  overrides === 0
    ? 'Every spawn follows this unless it has its own event.'
    : `Every spawn follows this unless it has its own event (${overrides} ${overrides === 1 ? 'does' : 'do'}).`;

/**
 * Who the NPC is: its name and title, levels, side, rank and what it offers players; and who sees it
 * (a template flag, so every spawn) and which game events its spawns follow (each spawn can have its own).
 */
export function NpcBasics({
  npc,
  onChange,
  events = [],
  spawns = 0,
  overrides = 0,
  spirit = false,
}: {
  npc: CustomNpc;
  onChange(next: CustomNpc): void;
  /** The game events the database has */
  events?: readonly GameEvent[];
  /** How many spawns it has, and how many follow events of their own */
  spawns?: number;
  overrides?: number;
  /** A spirit healer or guide, which only the dead see whatever is set */
  spirit?: boolean;
}): React.JSX.Element {
  const read = npc.origin.kind === 'existing' ? (npc.origin.original.creature_template?.[0] ?? {}) : {};
  const seenBy = npc.seenBy ?? seenByOf(read);
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
            className="entry-card__btn" onClick={() => onChange({ ...npc, faction: f.id })}>
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
      <div className="scene-section">
        <h4 className="scene-section__title">Visibility</h4>
        <SelectField label="Seen by" value={seenBy} options={SEEN_BY_OPTIONS} disabled={spirit} onChange={(next) => onChange({ ...npc, seenBy: next })} />
        <p className="scene-hint">{everySpawn(spawns)}</p>
        {spirit && <p className="scene-hint">A spirit healer or spirit guide is only seen by dead players.</p>}
        <EventRuleField id={`npc-${npc.entry}-events`} events={events} value={npc.events} asIs={npc.events === 'asIs'}
          onChange={(next) => onChange({ ...npc, events: next as EventRule | 'asIs' })} />
        <p className="scene-hint">{ownEvents(overrides)}</p>
      </div>
    </div>
  );
}

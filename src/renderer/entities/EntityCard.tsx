import type { CustomNpc, CustomObject, NpcRank, NpcType, ObjectType, Page, Spawn } from '@core/entities/model';
import { CheckField, NumberField, SelectField, TextField } from '../scripts/fields';
import { SpawnList } from './SpawnList';
import { LootList } from './LootList';
import { FightEditor } from '../combat/FightEditor';

const RANKS: readonly (readonly [NpcRank, string])[] = [
  ['normal', 'Normal'],
  ['elite', 'Elite'],
  ['rare', 'Rare'],
  ['rareElite', 'Rare elite'],
  ['boss', 'Boss'],
];

const NPC_TYPES: readonly (readonly [NpcType, string])[] = [
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

const OBJECT_TYPES: readonly (readonly [ObjectType, string])[] = [
  ['goober', 'Usable object'],
  ['chest', 'Chest (can be looted)'],
  ['questGiver', 'Quest giver'],
  ['text', 'Readable'],
  ['generic', 'Decoration'],
];

interface CardFrame {
  title: string;
  onRemove(): void;
  children: React.ReactNode;
}

function Card({ title, onRemove, children }: CardFrame): React.JSX.Element {
  return (
    <fieldset className="entry-card scene-card" aria-label={title}>
      <div className="entry-card__head">
        <h3 className="entry-card__title">{title}</h3>
        <button type="button" className="entry-card__btn entry-card__btn--danger" onClick={onRemove}>
          Remove
        </button>
      </div>
      {children}
    </fieldset>
  );
}

export function NpcCard({
  npc,
  onChange,
  onRemove,
  allocateSpawn,
}: {
  npc: CustomNpc;
  onChange(next: CustomNpc): void;
  onRemove(): void;
  allocateSpawn(): Promise<number | null>;
}): React.JSX.Element {
  return (
    <Card title={`NPC: ${npc.name.trim() || npc.entry}`} onRemove={onRemove}>
      <p className="scene-hint">Entry {npc.entry}</p>
      <TextField label="Name" value={npc.name} onChange={(name) => onChange({ ...npc, name })} />
      <TextField label="Subname" value={npc.subname} onChange={(subname) => onChange({ ...npc, subname })} />
      <div className="scene-row">
        <NumberField label="Min level" value={npc.minLevel} min={1} onChange={(minLevel) => onChange({ ...npc, minLevel: Math.round(minLevel) })} />
        <NumberField label="Max level" value={npc.maxLevel} min={1} onChange={(maxLevel) => onChange({ ...npc, maxLevel: Math.round(maxLevel) })} />
        <NumberField label="Faction ID" value={npc.faction} onChange={(faction) => onChange({ ...npc, faction: Math.round(faction) })} />
      </div>
      <div className="scene-row">
        <NumberField label="Model ID" value={npc.displayId} onChange={(displayId) => onChange({ ...npc, displayId: Math.round(displayId) })} />
        <NumberField label="Scale" value={npc.scale} onChange={(scale) => onChange({ ...npc, scale })} />
      </div>
      <div className="scene-row">
        <SelectField label="Rank" value={npc.rank} options={RANKS} onChange={(rank) => onChange({ ...npc, rank })} />
        <SelectField label="Type" value={npc.type} options={NPC_TYPES} onChange={(type) => onChange({ ...npc, type })} />
      </div>
      <CheckField label="Gives quests" value={npc.questGiver} onChange={(questGiver) => onChange({ ...npc, questGiver })} />
      <CheckField label="Can be talked to" value={npc.gossip} onChange={(gossip) => onChange({ ...npc, gossip })} />
      <div className="scene-row">
        <NumberField label="Health multiplier" value={npc.healthModifier} onChange={(healthModifier) => onChange({ ...npc, healthModifier })} />
        <NumberField label="Damage multiplier" value={npc.damageModifier} onChange={(damageModifier) => onChange({ ...npc, damageModifier })} />
      </div>
      <FightEditor idPrefix={`npc-${npc.entry}`} fight={npc.fight} onChange={(fight) => onChange({ ...npc, fight })} />
      <LootList idPrefix={`npc-${npc.entry}`} loot={npc.loot} onChange={(loot) => onChange({ ...npc, loot })} />
      <SpawnList
        idPrefix={`npc-${npc.entry}`}
        spawns={npc.spawns}
        wanders
        onChange={(spawns: Spawn[]) => onChange({ ...npc, spawns })}
        allocate={allocateSpawn}
      />
    </Card>
  );
}

/** The text a readable or usable object shows, one page after another. */
function PageList({ pages, onChange, allocate }: { pages: readonly Page[]; onChange(next: Page[]): void; allocate(): Promise<number | null> }): React.JSX.Element {
  const set = (i: number, page: Page): void => onChange(pages.map((p, j) => (j === i ? page : p)));
  const move = (i: number, by: -1 | 1): void => {
    const next = [...pages];
    const [taken] = next.splice(i, 1);
    next.splice(i + by, 0, taken!);
    onChange(next);
  };
  async function add(): Promise<void> {
    const id = await allocate();
    if (id !== null) onChange([...pages, { id, text: '' }]);
  }
  return (
    <div className="scene-section">
      <h4 className="scene-section__title">Pages</h4>
      {pages.length === 0 && <p className="scene-hint">No pages yet. Using the object shows the first page.</p>}
      <ol className="scene-steps">
        {pages.map((page, i) => (
          <li key={page.id} className="scene-step">
            <div className="scene-step__head">
              <strong>Page {i + 1}</strong>
              <span className="entry-card__actions">
                <button type="button" className="entry-card__btn" disabled={i === 0} onClick={() => move(i, -1)}>
                  Up
                </button>
                <button type="button" className="entry-card__btn" disabled={i === pages.length - 1} onClick={() => move(i, 1)}>
                  Down
                </button>
                <button type="button" className="entry-card__btn entry-card__btn--danger" onClick={() => onChange(pages.filter((_, j) => j !== i))}>
                  Remove
                </button>
              </span>
            </div>
            <TextField label={`Page ${i + 1}`} long value={page.text} onChange={(text) => set(i, { ...page, text })} />
          </li>
        ))}
      </ol>
      <button type="button" className="btn" onClick={() => void add()}>
        Add page
      </button>
    </div>
  );
}

export function ObjectCard({
  object,
  onChange,
  onRemove,
  allocateSpawn,
  allocatePage,
}: {
  object: CustomObject;
  onChange(next: CustomObject): void;
  onRemove(): void;
  allocateSpawn(): Promise<number | null>;
  allocatePage(): Promise<number | null>;
}): React.JSX.Element {
  return (
    <Card title={`Object: ${object.name.trim() || object.entry}`} onRemove={onRemove}>
      <p className="scene-hint">Entry {object.entry}</p>
      <TextField label="Name" value={object.name} onChange={(name) => onChange({ ...object, name })} />
      <SelectField label="Type" value={object.type} options={OBJECT_TYPES} onChange={(type) => onChange({ ...object, type })} />
      <div className="scene-row">
        <NumberField label="Model ID" value={object.displayId} onChange={(displayId) => onChange({ ...object, displayId: Math.round(displayId) })} />
        <NumberField label="Size" value={object.size} onChange={(size) => onChange({ ...object, size })} />
      </div>
      {(object.type === 'goober' || object.type === 'chest') && (
        <CheckField
          label="Only usable while this quest is in the log"
          value={object.onlyDuringQuest}
          onChange={(onlyDuringQuest) => onChange({ ...object, onlyDuringQuest })}
        />
      )}
      {(object.type === 'text' || object.type === 'goober') && (
        <PageList pages={object.pages} onChange={(pages) => onChange({ ...object, pages })} allocate={allocatePage} />
      )}
      {object.type === 'chest' && (
        <LootList idPrefix={`obj-${object.entry}`} loot={object.loot} onChange={(loot) => onChange({ ...object, loot })} />
      )}
      <SpawnList
        idPrefix={`obj-${object.entry}`}
        spawns={object.spawns}
        wanders={false}
        onChange={(spawns: Spawn[]) => onChange({ ...object, spawns })}
        allocate={allocateSpawn}
      />
    </Card>
  );
}

import { vendorUnread, type CustomNpc, type Spawn } from '@core/entities/model';
import { npcSpawnFacts } from '@core/entities/spawn-events';
import { isSpiritNpc } from '@core/entities/visibility';
import { EMPTY_WORLD } from '@core/world/layer';
import type { GameEvent } from '../../controls/EventPicker';
import { FightEditor } from '../../combat/FightEditor';
import { CreditQuestsProvider } from '../../combat/credit-quests';
import { NumberField } from '../../scripts/fields';
import { EditorTabs, type EditorTab } from '../EditorTabs';
import { CopyStock } from '../CopyStock';
import { LootList } from '../LootList';
import { GossipTab } from '../GossipTab';
import { ScriptsTab } from '../ScriptsTab';
import { TrainerTab } from '../TrainerTab';
import { VendorList } from '../VendorList';
import { SpawnList } from '../SpawnList';
import { NpcBasics } from './NpcBasics';
import { NpcLook } from './NpcLook';
import { type ExistingFacts, ExistingLoot } from '../existing-facts';
import '../../scripts/scripts.css';

/**
 * Everything about one NPC, in tabs: the only place its fields are edited. An existing one (`existing`)
 * has no Placement tab (its spawns are changed in the World view) and leaves locked parts alone.
 */
export function NpcEditor({
  npc,
  onChange,
  allocateSpawn,
  allocateTrainer = async () => null,
  allocateGossip = async () => null,
  tab,
  onTab,
  hasServerData = true,
  others,
  quests = [],
  existing,
  events = [],
  spawnFacts,
}: {
  npc: CustomNpc;
  /** Set when the database already has it */
  existing?: ExistingFacts;
  /** This quest's other new NPCs, which "Look like…" can copy before the database has them. */
  others?: readonly CustomNpc[];
  onChange(next: CustomNpc): void;
  allocateSpawn(): Promise<number | null>;
  /** A free trainer id for an NPC that starts to teach, or null when there is none */
  allocateTrainer?(): Promise<number | null>;
  /** Free gossip menu or text ids, `count` of the kind; null when there are none */
  allocateGossip?(kind: 'gossipMenu' | 'gossipText', count: number): Promise<number[] | null>;
  tab?: string;
  onTab?(id: string): void;
  /** Whether looks can be named, from the server data folder. */
  hasServerData?: boolean;
  /** The project's quests a fight's credit can name, those that use the NPC first */
  quests?: readonly { questId: number; title: string }[];
  /** The game events the database has */
  events?: readonly GameEvent[];
  /** How many spawns it has and how many follow events of their own (the host counts the world layer's) */
  spawnFacts?: { spawns: number; overrides: number };
}): React.JSX.Element {
  const facts = spawnFacts ?? npcSpawnFacts(npc, EMPTY_WORLD, existing?.spawnCount ?? 0);
  const credit = { quests, defaultQuest: quests[0]?.questId ?? 0 };
  const fightLocked = existing?.locked.includes('fight') ?? false;
  const name = npc.name.trim() || `NPC ${npc.entry}`;
  const tabs: EditorTab[] = [
    { id: 'basics', label: 'Basics', render: () => (
      <NpcBasics npc={npc} onChange={onChange} events={events} spawns={facts.spawns} overrides={facts.overrides} spirit={isSpiritNpc(npc)} />
    ) },
    { id: 'look', label: 'Look & gear', render: () => <NpcLook npc={npc} onChange={onChange} others={others} hasServerData={hasServerData} /> },
    {
      id: 'fight',
      label: 'Fight',
      render: () => (
        <div className="scripts-body">
          <div className="scene-row">
            <NumberField label="Health multiplier" value={npc.healthModifier} onChange={(healthModifier) => onChange({ ...npc, healthModifier })} />
            <NumberField label="Damage multiplier" value={npc.damageModifier} onChange={(damageModifier) => onChange({ ...npc, damageModifier })} />
          </div>
          {fightLocked ? (
            <p className="scene-hint">{name} already has scripts in the database, so its fight is not edited here.</p>
          ) : (
            <CreditQuestsProvider value={credit}>
              <FightEditor idPrefix={`npc-${npc.entry}`} entry={npc.entry} fight={npc.fight} onChange={(fight) => onChange({ ...npc, fight })} />
            </CreditQuestsProvider>
          )}
        </div>
      ),
    },
    {
      id: 'loot',
      label: 'Loot',
      render: () => (
        <ExistingLoot existing={existing}>
          <LootList idPrefix={`npc-${npc.entry}`} loot={npc.loot} onChange={(loot) => onChange({ ...npc, loot })} />
        </ExistingLoot>
      ),
    },
  ];
  tabs.push({
    id: 'vendor',
    label: 'Vendor',
    render: () =>
      // Stock a project saved before vendors existed never read is left as the database has it
      vendorUnread(npc) ? (
        <p className="scene-hint">
          {name}&apos;s stock was not read when it was added to this project, so it is not edited here. Choose Put back as the database has it, then edit it again, to read its stock.
        </p>
      ) : (
        <>
          <VendorList idPrefix={`npc-${npc.entry}`} vendor={npc.vendor} onChange={(vendor) => onChange({ ...npc, vendor })} hasServerData={hasServerData} />
          <CopyStock idPrefix={`npc-${npc.entry}`} npcEntry={npc.entry} current={npc.vendor} onCopy={(vendor) => onChange({ ...npc, vendor })} />
        </>
      ),
  });
  tabs.push({ id: 'trainer', label: 'Trainer', render: () => <TrainerTab npc={npc} onChange={onChange} allocateTrainer={allocateTrainer} /> });
  tabs.push({ id: 'gossip', label: 'Gossip', render: () => <GossipTab npc={npc} onChange={onChange} allocate={allocateGossip} onTab={onTab} /> });
  tabs.push({ id: 'scripts', label: 'Scripts', render: () => <ScriptsTab npc={npc} onChange={onChange} onTab={onTab} quests={quests} /> });
  if (!existing) {
    tabs.push({
      id: 'placement',
      label: 'Placement',
      render: () => (
        <SpawnList idPrefix={`npc-${npc.entry}`} ownerKey={{ kind: 'npc', entry: npc.entry }} spawns={npc.spawns} wanders
          onChange={(spawns: Spawn[]) => onChange({ ...npc, spawns })} allocate={allocateSpawn} eventChoices={events} />
      ),
    });
  }
  return <EditorTabs label="NPC" tab={tab} onTab={onTab} tabs={tabs} />;
}

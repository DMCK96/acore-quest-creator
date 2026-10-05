import type { CustomNpc, Spawn } from '@core/entities/model';
import { FightEditor } from '../../combat/FightEditor';
import { CreditQuestsProvider } from '../../combat/credit-quests';
import { NumberField } from '../../scripts/fields';
import { EditorTabs, type EditorTab } from '../EditorTabs';
import { LootList } from '../LootList';
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
  tab,
  onTab,
  hasServerData = true,
  others,
  quests = [],
  existing,
}: {
  npc: CustomNpc;
  /** Set when the database already has it */
  existing?: ExistingFacts;
  /** This quest's other new NPCs, which "Look like…" can copy before the database has them. */
  others?: readonly CustomNpc[];
  onChange(next: CustomNpc): void;
  allocateSpawn(): Promise<number | null>;
  tab?: string;
  onTab?(id: string): void;
  /** Whether looks can be named, from the server data folder. */
  hasServerData?: boolean;
  /** The project's quests a fight's credit can name, those that use the NPC first */
  quests?: readonly { questId: number; title: string }[];
}): React.JSX.Element {
  const credit = { quests, defaultQuest: quests[0]?.questId ?? 0 };
  const fightLocked = existing?.locked.includes('fight') ?? false;
  const name = npc.name.trim() || `NPC ${npc.entry}`;
  const tabs: EditorTab[] = [
    { id: 'basics', label: 'Basics', render: () => <NpcBasics npc={npc} onChange={onChange} /> },
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
  if (!existing) {
    tabs.push({
      id: 'placement',
      label: 'Placement',
      render: () => (
        <SpawnList idPrefix={`npc-${npc.entry}`} ownerKey={{ kind: 'npc', entry: npc.entry }} spawns={npc.spawns} wanders
          onChange={(spawns: Spawn[]) => onChange({ ...npc, spawns })} allocate={allocateSpawn} />
      ),
    });
  }
  return <EditorTabs label="NPC" tab={tab} onTab={onTab} tabs={tabs} />;
}

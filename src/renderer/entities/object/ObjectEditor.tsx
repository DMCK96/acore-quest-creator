import type { CustomObject, Spawn } from '@core/entities/model';
import { EditorTabs, type EditorTab } from '../EditorTabs';
import { LootList } from '../LootList';
import { SpawnList } from '../SpawnList';
import { ExistingLoot, type ExistingFacts } from '../existing-facts';
import { ObjectBasics } from './ObjectBasics';
import { ObjectLook } from './ObjectLook';
import { PageList } from './PageList';
import '../../scripts/scripts.css';

/**
 * Everything about one object, in tabs: the only place its fields are edited. An existing one
 * (`existing`) has no Placement tab, and one of a type this editor does not have keeps it, with no Contents.
 */
export function ObjectEditor({
  object,
  onChange,
  allocateSpawn,
  allocatePage,
  tab,
  onTab,
  hasServerData = true,
  quests = [],
  existing,
}: {
  object: CustomObject;
  /** Set when the database already has it */
  existing?: ExistingFacts;
  onChange(next: CustomObject): void;
  allocateSpawn(): Promise<number | null>;
  allocatePage(): Promise<number | null>;
  tab?: string;
  onTab?(id: string): void;
  /** Whether looks can be named, from the server data folder. */
  hasServerData?: boolean;
  /** The quests an object can be limited to, those that use it first */
  quests?: readonly { questId: number; title: string }[];
}): React.JSX.Element {
  const typeLocked = existing?.locked.includes('type') ?? false;
  const hasPages = object.type === 'text' || object.type === 'goober';
  const tabs: EditorTab[] = [
    { id: 'basics', label: 'Basics', render: () => <ObjectBasics object={object} onChange={onChange} quests={quests} typeLocked={typeLocked} /> },
    { id: 'look', label: 'Look', render: () => <ObjectLook object={object} onChange={onChange} hasServerData={hasServerData} /> },
  ];
  // Only an object that shows pages or can be looted has contents.
  if (!typeLocked && (hasPages || object.type === 'chest')) {
    tabs.push({
      id: 'contents',
      label: 'Contents',
      render: () => (
        <div className="scripts-body">
          {hasPages && <PageList pages={object.pages} onChange={(pages) => onChange({ ...object, pages })} allocate={allocatePage} />}
          {object.type === 'chest' && (
            <ExistingLoot existing={existing}>
              <LootList idPrefix={`obj-${object.entry}`} loot={object.loot} onChange={(loot) => onChange({ ...object, loot })} />
            </ExistingLoot>
          )}
        </div>
      ),
    });
  }
  if (!existing) {
    tabs.push({
      id: 'placement',
      label: 'Placement',
      render: () => (
        <SpawnList idPrefix={`obj-${object.entry}`} ownerKey={{ kind: 'obj', entry: object.entry }} spawns={object.spawns} wanders={false}
          onChange={(spawns: Spawn[]) => onChange({ ...object, spawns })} allocate={allocateSpawn} />
      ),
    });
  }
  return <EditorTabs label="Object" tab={tab} onTab={onTab} tabs={tabs} />;
}

import type { CustomObject, Spawn } from '@core/entities/model';
import { EditorTabs, type EditorTab } from '../EditorTabs';
import { LootList } from '../LootList';
import { SpawnList } from '../SpawnList';
import { ObjectBasics } from './ObjectBasics';
import { ObjectLook } from './ObjectLook';
import { PageList } from './PageList';
import '../../scripts/scripts.css';

/** Everything about one new object, in tabs: the only place its fields are edited. */
export function ObjectEditor({
  object,
  onChange,
  allocateSpawn,
  allocatePage,
  tab,
  onTab,
  hasServerData = true,
}: {
  object: CustomObject;
  onChange(next: CustomObject): void;
  allocateSpawn(): Promise<number | null>;
  allocatePage(): Promise<number | null>;
  tab?: string;
  onTab?(id: string): void;
  /** Whether looks can be named, from the server data folder. */
  hasServerData?: boolean;
}): React.JSX.Element {
  const hasPages = object.type === 'text' || object.type === 'goober';
  const tabs: EditorTab[] = [
    { id: 'basics', label: 'Basics', render: () => <ObjectBasics object={object} onChange={onChange} /> },
    { id: 'look', label: 'Look', render: () => <ObjectLook object={object} onChange={onChange} hasServerData={hasServerData} /> },
  ];
  // Only an object that shows pages or can be looted has contents.
  if (hasPages || object.type === 'chest') {
    tabs.push({
      id: 'contents',
      label: 'Contents',
      render: () => (
        <div className="scripts-body">
          {hasPages && <PageList pages={object.pages} onChange={(pages) => onChange({ ...object, pages })} allocate={allocatePage} />}
          {object.type === 'chest' && <LootList idPrefix={`obj-${object.entry}`} loot={object.loot} onChange={(loot) => onChange({ ...object, loot })} />}
        </div>
      ),
    });
  }
  tabs.push({
    id: 'placement',
    label: 'Placement',
    render: () => (
      <SpawnList idPrefix={`obj-${object.entry}`} ownerKey={{ kind: 'obj', entry: object.entry }} spawns={object.spawns} wanders={false}
        onChange={(spawns: Spawn[]) => onChange({ ...object, spawns })} allocate={allocateSpawn} />
    ),
  });
  return <EditorTabs label="Object" tab={tab} onTab={onTab} tabs={tabs} />;
}

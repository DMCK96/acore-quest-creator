import { useState } from 'react';
import type { CustomItem } from '@core/entities/model';
import type { ColumnInfo } from '@core/db/types';
import { EditorTabs, type EditorTab } from '../EditorTabs';
import { PageList } from '../object/PageList';
import { ItemAdvanced } from './ItemAdvanced';
import { ItemBasics } from './ItemBasics';
import { ItemGear } from './ItemGear';
import { ItemSpells } from './ItemSpells';
import type { ExistingFacts } from '../existing-facts';
import '../../scripts/scripts.css';

export const SHOW_ADVANCED_KEY = 'acqc.item.showAdvanced';

// Storage can be missing or refuse (a locked-down profile); the editor works the same without it.
function readShowAdvanced(): boolean {
  try {
    return localStorage.getItem(SHOW_ADVANCED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeShowAdvanced(on: boolean): void {
  try {
    localStorage.setItem(SHOW_ADVANCED_KEY, on ? '1' : '0');
  } catch {
    // Not remembered, which is all that is lost.
  }
}

/** Everything about one new item, in tabs; the rarely used columns stay hidden until asked for. */
export function ItemEditor({
  item,
  onChange,
  allocatePage,
  copyLook,
  columns,
  tab,
  onTab,
  // An item has no loot, fight or placement, so nothing differs yet for an existing one
  existing: _existing,
}: {
  item: CustomItem;
  /** Set when the database already has it */
  existing?: ExistingFacts;
  onChange(next: CustomItem): void;
  allocatePage(): Promise<number | null>;
  copyLook(entry: number): Promise<Partial<CustomItem> | null>;
  columns: readonly ColumnInfo[];
  tab?: string;
  onTab?(id: string): void;
}): React.JSX.Element {
  const [showAdvanced, setShowAdvanced] = useState(readShowAdvanced);
  const toggle = (on: boolean): void => {
    setShowAdvanced(on);
    writeShowAdvanced(on);
  };
  const tabs: EditorTab[] = [
    { id: 'basics', label: 'Basics', render: () => <ItemBasics item={item} onChange={onChange} copyLook={copyLook} /> },
    { id: 'gear', label: 'Gear', render: () => <ItemGear item={item} onChange={onChange} /> },
    { id: 'spells', label: 'Spells', render: () => <ItemSpells item={item} onChange={onChange} /> },
    {
      id: 'pages',
      label: 'Pages',
      render: () => (
        <div className="scripts-body">
          <p className="scene-hint">Pages make the item readable: right-clicking it shows the first page.</p>
          <PageList pages={item.pages} onChange={(pages) => onChange({ ...item, pages })} allocate={allocatePage} />
        </div>
      ),
    },
  ];
  if (showAdvanced) tabs.push({ id: 'advanced', label: 'Advanced', render: () => <ItemAdvanced item={item} onChange={onChange} columns={columns} /> });
  return (
    <>
      <EditorTabs label="Item" tab={tab} onTab={onTab} tabs={tabs} />
      <label className="scene-field scene-field--check">
        <input type="checkbox" checked={showAdvanced} onChange={(e) => toggle(e.target.checked)} />
        <span>Show advanced fields</span>
      </label>
      {!showAdvanced && Object.keys(item.advanced).length > 0 && <p className="scene-hint">Some advanced fields have values.</p>}
    </>
  );
}

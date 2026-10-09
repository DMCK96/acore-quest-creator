import { useState } from 'react';
import type { CustomNpc, VendorItem } from '@core/entities/model';
import { EntityField } from '../scripts/fields';
import { useApi } from '../state/names';
import { useProjectEntities } from '../state/project-entities';

/** "Copy stock from…": replaces an NPC's stock with another NPC's, new or from the database */
export function CopyStock({
  idPrefix, npcEntry, current, onCopy,
}: { idPrefix: string; npcEntry: number; current: readonly VendorItem[]; onCopy(vendor: VendorItem[]): void }): React.JSX.Element {
  const api = useApi();
  const project = useProjectEntities();
  const [source, setSource] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function copy(): Promise<void> {
    setError(null);
    if (source === npcEntry) {
      setError('That is this NPC.');
      return;
    }
    let from: CustomNpc | undefined = project?.entities.npcs.find((n) => n.entry === source);
    if (!from) {
      if (!api) {
        setError('Copying stock from the database needs the world database.');
        return;
      }
      const read = await api.readExistingEntity('npc', source);
      if (!read.ok) {
        setError(read.error.message);
        return;
      }
      from = read.value as CustomNpc;
    }
    if (from.vendor.length === 0) {
      setError('That NPC has no stock to copy.');
      return;
    }
    const name = from.name.trim() || `NPC ${source}`;
    if (current.length > 0 && !window.confirm(`Replace this NPC's ${current.length} item${current.length === 1 ? '' : 's'} with the ${from.vendor.length} from ${name}?`)) return;
    onCopy(from.vendor.map((row) => ({ ...row })));
    setSource(0);
  }

  return (
    <div className="scene-section">
      <EntityField id={`${idPrefix}-copy-stock`} label="Copy stock from…" kind="creature" value={source} onChange={setSource} />
      <button type="button" className="btn" disabled={source === 0} onClick={() => void copy()}>
        Copy
      </button>
      {error && <p role="alert" className="control__alert">{error}</p>}
    </div>
  );
}

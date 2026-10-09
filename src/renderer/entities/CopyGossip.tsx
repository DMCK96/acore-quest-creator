import { useState } from 'react';
import { freshTree } from '@core/entities/gossip-tree';
import { gossipUnread, type CustomNpc, type GossipTree } from '@core/entities/model';
import { EntityField } from '../scripts/fields';
import { useApi } from '../state/names';
import { useProjectEntities } from '../state/project-entities';

export type AllocateGossip = (kind: 'gossipMenu' | 'gossipText', count: number) => Promise<number[] | null>;

export const NO_GOSSIP_IDS = 'Could not get free gossip ids.';

/** Fresh menu and text ids for `count` menus, or null when none could be got */
export async function gossipIds(allocate: AllocateGossip, count: number): Promise<{ menu: number; text: number }[] | null> {
  const menus = await allocate('gossipMenu', count);
  const texts = await allocate('gossipText', count);
  if (!menus || !texts || menus.length < count || texts.length < count) return null;
  return menus.map((menu, i) => ({ menu, text: texts[i]! }));
}

/** "Copy menu from…": replaces an NPC's gossip tree with a copy of another NPC's, new or from the database, under new ids */
export function CopyGossip({
  idPrefix, npcEntry, current, allocate, onCopy,
}: { idPrefix: string; npcEntry: number; current: GossipTree | null; allocate: AllocateGossip; onCopy(next: GossipTree): void }): React.JSX.Element {
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
    // A project NPC whose gossip was never read has none to copy: the database's is read instead
    let from: CustomNpc | undefined = project?.entities.npcs.find((n) => n.entry === source);
    if (from && gossipUnread(from)) from = undefined;
    if (!from) {
      if (!api) {
        setError('Copying from the database needs the world database.');
        return;
      }
      const read = await api.readExistingEntity('npc', source);
      if (!read.ok) {
        setError(read.error.message);
        return;
      }
      from = read.value as CustomNpc;
    }
    if (!from.gossipMenu) {
      setError('That NPC has no gossip menu.');
      return;
    }
    const name = from.name.trim() || `NPC ${source}`;
    if (current && !window.confirm(`Replace this NPC's gossip menu with a copy of ${name}'s?`)) return;
    const ids = await gossipIds(allocate, from.gossipMenu.menus.length);
    if (!ids) {
      setError(NO_GOSSIP_IDS);
      return;
    }
    onCopy(freshTree(from.gossipMenu, ids));
    setSource(0);
  }

  return (
    <div className="scene-section">
      <EntityField id={`${idPrefix}-copy-gossip`} label="Copy menu from…" kind="creature" value={source} onChange={setSource} />
      <button type="button" className="btn" disabled={source === 0} onClick={() => void copy()}>
        Copy
      </button>
      {error && <p role="alert" className="control__alert">{error}</p>}
    </div>
  );
}

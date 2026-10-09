import { useState } from 'react';
import { blankMenu, copyMenus, copySetOf } from '@core/entities/gossip-tree';
import { gossipUnread, type CustomNpc, type GossipMenu, type GossipTree } from '@core/entities/model';
import { serviceLabel } from '@core/game/gossip-services';
import { CopyGossip, gossipIds, NO_GOSSIP_IDS, type AllocateGossip } from './CopyGossip';
import { GossipMenuEditor, menuLabel } from './GossipMenuEditor';

/** A locked menu, read-only: what it says and what its options do */
function MenuSummary({ menu }: { menu: GossipMenu }): React.JSX.Element {
  return (
    <>
      {menu.greeting.map((v, i) => (
        <p key={i}>Says: {v.text}</p>
      ))}
      <ul>
        {menu.options.map((o) => (
          <li key={o.optionId}>
            {o.text}
            {o.action.kind === 'menu' ? ` → menu ${o.action.menuId}` : o.action.kind === 'service' ? ` → ${serviceLabel(o.action.type, o.action.npcFlag)}` : ''}
          </li>
        ))}
      </ul>
    </>
  );
}

/** The Gossip tab's body: give the NPC a menu tree, edit its menus, or copy the menus other NPCs share */
export function GossipTab({
  npc, onChange, allocate, onTab,
}: { npc: CustomNpc; onChange(next: CustomNpc): void; allocate: AllocateGossip; onTab?(id: string): void }): React.JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState(0);
  const name = npc.name.trim() || `NPC ${npc.entry}`;
  const idPrefix = `npc-${npc.entry}`;

  // Gossip a project saved before gossip (or a fork without the tables) never read is not ours to write
  if (gossipUnread(npc)) {
    return (
      <p className="scene-hint">
        {name}&apos;s gossip was not read when it was added to this project, so it is not edited here. Choose Put back as the database has it, then edit it again, to read it.
      </p>
    );
  }

  const tree = npc.gossipMenu;
  const alert = error && <p role="alert" className="control__alert">{error}</p>;
  const setTree = (next: GossipTree | null): void => onChange({ ...npc, gossipMenu: next });

  async function make(): Promise<void> {
    setError(null);
    const ids = await gossipIds(allocate, 1);
    if (!ids) {
      setError(NO_GOSSIP_IDS);
      return;
    }
    setPicked(0);
    onChange({ ...npc, gossip: true, gossipMenu: { menus: [blankMenu(ids[0]!.menu, ids[0]!.text)] } });
  }

  /** A new blank menu for an option to open; null (with the alert) when no ids could be got */
  async function newMenu(): Promise<GossipMenu | null> {
    setError(null);
    const ids = await gossipIds(allocate, 1);
    if (!ids) {
      setError(NO_GOSSIP_IDS);
      return null;
    }
    return blankMenu(ids[0]!.menu, ids[0]!.text);
  }

  /** Replaces the given locked menus by copies the NPC owns */
  async function copyLocked(which: readonly number[]): Promise<void> {
    if (!tree || which.length === 0) return;
    setError(null);
    const tied = tree.menus.some((m) => which.includes(m.menuId) && m.options.some((o) => o.kept));
    if (tied && !window.confirm('Its conditions and scripts stay with the original, so options tied to them are copied as ordinary ones. Copy anyway?')) return;
    const ids = await gossipIds(allocate, which.length);
    if (!ids) {
      setError(NO_GOSSIP_IDS);
      return;
    }
    setTree(copyMenus(tree, which, ids));
  }

  const remove = (): void => {
    const options = tree?.menus.reduce((n, m) => n + m.options.length, 0) ?? 0;
    if (options > 0 && !window.confirm(`Make ${name} stop having a gossip menu?`)) return;
    setPicked(0);
    setTree(null);
  };

  if (!tree) {
    return (
      <>
        <div className="scene-section">
          <h4 className="scene-section__title">Gossip</h4>
          <p className="scene-hint">This NPC has no gossip menu.</p>
          <button type="button" className="btn" onClick={() => void make()}>
            Give this NPC a gossip menu
          </button>
        </div>
        {alert}
        <CopyGossip idPrefix={idPrefix} npcEntry={npc.entry} current={null} allocate={allocate} onCopy={(next) => onChange({ ...npc, gossip: true, gossipMenu: next })} />
      </>
    );
  }

  const index = Math.min(picked, tree.menus.length - 1);
  const menu = tree.menus[index]!;
  const sharedBy = npc.origin.kind === 'existing' ? (npc.origin.sharedMenus?.[String(menu.menuId)] ?? 0) : 0;
  const lockedIds = tree.menus.filter((m) => m.locked).map((m) => m.menuId);

  return (
    <>
      {!npc.gossip && (
        <p className="scene-hint">
          Players cannot open this menu until Can be talked to is on.{' '}
          <button type="button" className="btn" onClick={() => onChange({ ...npc, gossip: true })}>
            Turn it on
          </button>
        </p>
      )}
      {tree.menus.length > 1 && (
        <div role="group" aria-label="Menus" className="scene-row">
          {tree.menus.map((m, i) => (
            <button key={m.menuId} type="button" className="btn" aria-pressed={i === index} onClick={() => setPicked(i)}>
              {menuLabel(m, i)}
            </button>
          ))}
        </div>
      )}
      {menu.locked ? (
        <div className="scene-section">
          <p className="scene-hint">
            {sharedBy > 0
              ? `${sharedBy} other ${sharedBy === 1 ? 'NPC or object uses' : 'NPCs or objects use'} this menu`
              : 'Other NPCs or objects use this menu, or the editor cannot change it'}
            : changing it would change theirs too.
          </p>
          <MenuSummary menu={menu} />
          <button type="button" className="btn" onClick={() => void copyLocked(copySetOf(tree, menu.menuId))}>
            Give it its own copy
          </button>{' '}
          <button type="button" className="btn" onClick={() => void copyLocked(lockedIds)}>
            Copy the whole menu tree
          </button>
        </div>
      ) : (
        <GossipMenuEditor npc={npc} tree={tree} index={index} onChange={(next) => setTree(next)} newMenu={newMenu} onTab={onTab} />
      )}
      {alert}
      <button type="button" className="btn" onClick={remove}>
        Remove gossip menu
      </button>
      <CopyGossip idPrefix={idPrefix} npcEntry={npc.entry} current={tree} allocate={allocate} onCopy={(next) => { setPicked(0); onChange({ ...npc, gossip: true, gossipMenu: next }); }} />
    </>
  );
}

import { useEffect, useRef, useState } from 'react';
import type { Api, ApiError, Movement, Placement, RoutePoint, WorldChange, WorldLayer } from '@shared/ipc';
import type { CustomNpc, CustomObject, Spawn } from '@core/entities/model';
import { trapTab } from '../components/trap-tab';
import { otherUsers, useProjectEntities, type ProjectQuestUse } from '../state/project-entities';
import '../views/ProjectDialog.css';

/**
 * What the project adds to the world database: its new NPCs, objects and items (edit one, or go to
 * its spawn), and every edit in its world layer as it was in the database and as it is now (revert
 * one). Exports them all as the project patch and the patch that puts the database back.
 */
export function ProjectChanges({
  api,
  onLayer,
  onClose,
  onEdit,
  onGoTo,
  layerSeq = 0,
}: {
  api: Api;
  onLayer(layer: WorldLayer): void;
  onClose(): void;
  /** Opens the editor of one of the project's NPCs, objects or items */
  onEdit?(kind: 'npc' | 'object' | 'item', entry: number): void;
  /** Takes the camera to a spawn of one of the project's NPCs or objects */
  onGoTo?(kind: 'creature' | 'object', entity: CustomNpc | CustomObject, spawn: Spawn): void;
  /** Moves when an undo or redo changed the layer, so the list is read again */
  layerSeq?: number;
}): React.JSX.Element {
  const project = useProjectEntities();
  const entities = project?.entities;
  const count = entities ? entities.npcs.length + entities.objects.length + entities.items.length : 0;
  const dialog = useRef<HTMLDivElement>(null);
  const [changes, setChanges] = useState<WorldChange[] | null>(null);
  const [exported, setExported] = useState<{ applyPath: string; revertPath: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // What must be fixed before the patch can be written, one line each
  const [issues, setIssues] = useState<string[]>([]);

  const load = async (): Promise<void> => {
    const result = await api.worldChanges();
    if (result.ok) setChanges(result.value);
    else setError(result.error.message);
  };
  useEffect(() => {
    void load();
    // Loaded when opened, and again after an undo changed the layer; a revert loads again itself
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layerSeq]);

  const revert = async (change: WorldChange): Promise<void> => {
    const result = await api.worldRevert(
      change.type === 'route' ? { kind: 'route', pathId: change.pathId }
      : change.type === 'movement' ? { kind: 'movement', guid: change.guid }
      : change.type === 'respawn' ? { kind: 'respawn', spawnKind: change.kind, guid: change.guid }
      : { kind: 'spawn', spawnKind: change.kind, guid: change.guid },
    );
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    onLayer(result.value);
    setExported(null);
    await load();
  };

  const exportAll = async (): Promise<void> => {
    setError(null);
    setIssues([]);
    const result = await api.exportProject();
    if (result.ok) setExported({ applyPath: result.value.applyPath, revertPath: result.value.revertPath });
    else {
      setError(result.error.message);
      setIssues(errorsOf(result.error));
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialog}
        className="modal world-changes"
        role="dialog"
        aria-modal="true"
        aria-label="Project changes"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          trapTab(e, dialog.current);
        }}
      >
        <header className="modal__header">
          <h2>Project changes</h2>
          <button type="button" className="btn btn--icon" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        {entities && count > 0 && (
          <section className="project-changes__entities" aria-label="New NPCs, objects & items">
            <h3 className="section-label">New NPCs, objects &amp; items</h3>
            <ul className="project-changes__list">
              {entities.npcs.map((npc) => (
                <EntityRow key={`npc:${npc.entry}`} kind="npc" entry={npc.entry} name={npc.name} spawns={npc.spawns.length} quests={project.quests}
                  onEdit={onEdit} onGoTo={npc.spawns[0] && onGoTo ? () => onGoTo('creature', npc, npc.spawns[0]) : undefined} />
              ))}
              {entities.objects.map((object) => (
                <EntityRow key={`object:${object.entry}`} kind="object" entry={object.entry} name={object.name} spawns={object.spawns.length} quests={project.quests}
                  onEdit={onEdit} onGoTo={object.spawns[0] && onGoTo ? () => onGoTo('object', object, object.spawns[0]) : undefined} />
              ))}
              {entities.items.map((item) => (
                <EntityRow key={`item:${item.entry}`} kind="item" entry={item.entry} name={item.name} spawns={null} quests={project.quests} onEdit={onEdit} />
              ))}
            </ul>
          </section>
        )}
        {count > 0 && <h3 className="section-label">World changes</h3>}
        {changes && changes.length === 0 && <p>No world changes.</p>}
        {changes && changes.length > 0 && (
          <table className="world-changes__table">
            <thead>
              <tr>
                <th>What</th>
                <th>Before</th>
                <th>After</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {changes.map((change) => (
                <ChangeRow key={change.type === 'route' ? `route:${change.pathId}` : change.type === 'movement' ? `movement:${change.guid}` : change.type === 'respawn' ? `respawn:${change.kind}:${change.guid}` : `${change.type}:${change.kind}:${change.guid}`} change={change} onRevert={() => void revert(change)} />
              ))}
            </tbody>
          </table>
        )}
        {error && <p className="world-changes__error">{error}</p>}
        {issues.length > 0 && (
          <ul className="world-changes__error" aria-label="To fix">
            {issues.map((issue, i) => (
              <li key={i}>{issue}</li>
            ))}
          </ul>
        )}
        {exported && (
          <div className="world-changes__exported">
            <p>Written:</p>
            <p>{exported.applyPath}</p>
            <p>{exported.revertPath}</p>
          </div>
        )}
        <div className="world3d__dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn btn--primary" disabled={!changes || changes.length + count === 0} onClick={() => void exportAll()}>
            Export project patch
          </button>
        </div>
      </div>
    </div>
  );
}

/** The errors a refusal lists (its warnings are left out: they do not stop the export) */
const errorsOf = (error: ApiError): string[] => (error.issues ?? []).filter((i) => i.severity === 'error').map((i) => i.message);

const KIND_LABEL = { npc: 'NPC', object: 'Object', item: 'Item' } as const;
const USE_KEY = { npc: 'npcs', object: 'objects', item: 'items' } as const;

/** One of the project's NPCs, objects or items: what it is, how many spawns it has, and the quests that use it */
function EntityRow({
  kind, entry, name, spawns, quests, onEdit, onGoTo,
}: {
  kind: 'npc' | 'object' | 'item';
  entry: number;
  name: string;
  /** Null for items, which have none */
  spawns: number | null;
  quests: readonly ProjectQuestUse[];
  onEdit?(kind: 'npc' | 'object' | 'item', entry: number): void;
  onGoTo?(): void;
}): React.JSX.Element {
  const label = name.trim() || `${KIND_LABEL[kind]} ${entry}`;
  const users = otherUsers(quests, null, USE_KEY[kind], entry);
  const parts = [`${KIND_LABEL[kind]} ${entry}`];
  if (spawns !== null) parts.push(`${spawns} ${spawns === 1 ? 'spawn' : 'spawns'}`);
  if (users.length > 0) parts.push(`used by ${users.join(', ')}`);
  return (
    <li className="project-changes__entity" aria-label={label}>
      <span className="project-changes__name">{label}</span>
      <span className="project-changes__facts">{parts.join(' · ')}</span>
      <span className="project-changes__actions">
        <button type="button" className="btn" disabled={!onEdit} onClick={() => onEdit?.(kind, entry)}>
          Edit
        </button>
        <button type="button" className="btn" disabled={!onGoTo} onClick={onGoTo}>
          Go to
        </button>
      </span>
    </li>
  );
}

const where = (p: Placement): string => `${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}`;
/** How an NPC moves, in a few words */
const moves = (m: Movement): string => (m.type === 'path' ? `walks path ${m.pathId ?? 0}` : m.type === 'wander' ? `wanders ${m.wander} yd` : 'stands still');
const points = (route: readonly RoutePoint[]): string => `${route.length} ${route.length === 1 ? 'point' : 'points'}`;

function ChangeRow({ change, onRevert }: { change: WorldChange; onRevert(): void }): React.JSX.Element {
  const drift = change.drifted && (
    <span className="world-changes__drift">{change.type === 'added' ? 'The database has a spawn with this id now' : 'Changed in the database since'}</span>
  );
  if (change.type === 'added') {
    const name = change.name || `${change.kind === 'creature' ? 'NPC' : 'Object'} ${change.entry}`;
    return (
      <tr>
        <td>
          {name} · {change.kind === 'creature' ? 'NPC' : 'Object'} {change.entry} · new spawn {change.guid} {drift}
        </td>
        <td>Not placed yet</td>
        <td>{where(change.placement)}</td>
        <td>
          <button type="button" className="btn" aria-label={`Remove ${name}`} onClick={onRevert}>
            Remove
          </button>
        </td>
      </tr>
    );
  }
  if (change.type === 'movement') {
    const name = change.name || `NPC ${change.entry}`;
    return (
      <tr>
        <td>
          {name} · movement · spawn {change.guid} {drift}
        </td>
        <td>{moves(change.original)}</td>
        <td>{moves(change.current)}</td>
        <td>
          <button type="button" className="btn" aria-label={`Revert movement of ${name}`} onClick={onRevert}>
            Revert
          </button>
        </td>
      </tr>
    );
  }
  if (change.type === 'respawn') {
    const name = change.name || `${change.kind === 'creature' ? 'NPC' : 'Object'} ${change.entry}`;
    return (
      <tr>
        <td>
          {name} · respawn · spawn {change.guid} {drift}
        </td>
        <td>{change.original} s</td>
        <td>{change.current} s</td>
        <td>
          <button type="button" className="btn" aria-label={`Revert respawn of ${name}`} onClick={onRevert}>
            Revert
          </button>
        </td>
      </tr>
    );
  }
  if (change.type === 'spawn') {
    const name = change.name || `${change.kind === 'creature' ? 'NPC' : 'Object'} ${change.entry}`;
    return (
      <tr>
        <td>
          {name} · {change.kind === 'creature' ? 'NPC' : 'Object'} · spawn {change.guid} {drift}
        </td>
        <td>{where(change.original)}</td>
        <td>{where(change.current)}</td>
        <td>
          <button type="button" className="btn" aria-label={`Revert ${name}`} onClick={onRevert}>
            Revert
          </button>
        </td>
      </tr>
    );
  }
  return (
    <tr>
      <td>
        Route {change.pathId} · {change.walkers} {change.walkers === 1 ? 'spawn' : 'spawns'} {drift}
      </td>
      <td>{points(change.original)}</td>
      <td>{points(change.current)}</td>
      <td>
        <button type="button" className="btn" aria-label={`Revert route ${change.pathId}`} onClick={onRevert}>
          Revert
        </button>
      </td>
    </tr>
  );
}

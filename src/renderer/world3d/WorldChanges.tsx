import { useEffect, useRef, useState } from 'react';
import type { Api, Placement, RoutePoint, WorldChange, WorldLayer } from '@shared/ipc';
import { trapTab } from '../components/trap-tab';
import '../views/ProjectDialog.css';

/**
 * Every edit in the project's world layer, as it was in the database and as it is now: revert one,
 * or export them all as the world patch and the patch that puts the database back.
 */
export function WorldChanges({ api, onLayer, onClose }: { api: Api; onLayer(layer: WorldLayer): void; onClose(): void }): React.JSX.Element {
  const dialog = useRef<HTMLDivElement>(null);
  const [changes, setChanges] = useState<WorldChange[] | null>(null);
  const [exported, setExported] = useState<{ applyPath: string; revertPath: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async (): Promise<void> => {
    const result = await api.worldChanges();
    if (result.ok) setChanges(result.value);
    else setError(result.error.message);
  };
  useEffect(() => {
    void load();
    // Loaded once when opened; a revert loads again
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const revert = async (change: WorldChange): Promise<void> => {
    const result = await api.worldRevert(
      change.type === 'spawn' ? { kind: 'spawn', spawnKind: change.kind, guid: change.guid } : { kind: 'route', pathId: change.pathId },
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
    const result = await api.exportWorld();
    if (result.ok) setExported({ applyPath: result.value.applyPath, revertPath: result.value.revertPath });
    else setError(result.error.message);
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialog}
        className="modal world-changes"
        role="dialog"
        aria-modal="true"
        aria-label="World changes"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          trapTab(e, dialog.current);
        }}
      >
        <header className="modal__header">
          <h2>World changes</h2>
          <button type="button" className="btn btn--icon" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
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
                <ChangeRow key={change.type === 'spawn' ? `${change.kind}:${change.guid}` : `route:${change.pathId}`} change={change} onRevert={() => void revert(change)} />
              ))}
            </tbody>
          </table>
        )}
        {error && <p className="world-changes__error">{error}</p>}
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
          <button type="button" className="btn btn--primary" disabled={!changes || changes.length === 0} onClick={() => void exportAll()}>
            Export world patch
          </button>
        </div>
      </div>
    </div>
  );
}

const where = (p: Placement): string => `${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}`;
const points = (route: readonly RoutePoint[]): string => `${route.length} ${route.length === 1 ? 'point' : 'points'}`;

function ChangeRow({ change, onRevert }: { change: WorldChange; onRevert(): void }): React.JSX.Element {
  const drift = change.drifted && <span className="world-changes__drift">Changed in the database since</span>;
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
        Route {change.pathId} · {change.walkers} spawns {drift}
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

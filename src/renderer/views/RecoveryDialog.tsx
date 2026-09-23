import type { AppStore } from '../state/app-store';
import './ProjectDialog.css';

/**
 * Offered once after connecting when a crash left unsaved work behind. Only one project can be
 * open, so restoring one entry discards the rest (the store does that), which the text says first.
 */
export function RecoveryDialog({ store }: { store: AppStore }): React.JSX.Element | null {
  const recoveries = store((s) => s.recoveries);
  const { restoreRecovery, discardRecovery } = store.getState();
  if (recoveries.length === 0) return null;

  const restorable = recoveries.filter((r) => !r.damaged);

  return (
    <div className="modal-backdrop">
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="recovery-title">
        <header className="modal__header">
          <h2 id="recovery-title">Recover unsaved work</h2>
        </header>
        <p>The app closed without saving. This work can be brought back.</p>
        {restorable.length > 1 && <p>Restoring one discards the others.</p>}
        <ul className="project-dialog__recent">
          {recoveries.map((r) =>
            r.damaged ? (
              <li key={r.id} className="project-dialog__recent-row">
                <span className="project-dialog__recent-open project-dialog__recent-open--missing">Damaged recovery file</span>
                <button type="button" className="btn" onClick={() => void discardRecovery(r.id)}>
                  Discard damaged file
                </button>
              </li>
            ) : (
              <li key={r.id} className="project-dialog__recent-row">
                <span className="project-dialog__recent-open">
                  Unsaved work in <strong>{r.name}</strong>, {r.questCount} {r.questCount === 1 ? 'quest' : 'quests'}, from{' '}
                  {new Date(r.writtenAt).toLocaleString()}
                </span>
                <button type="button" className="btn btn--primary" aria-label={`Restore ${r.name}`} onClick={() => void restoreRecovery(r.id)}>
                  Restore
                </button>
                <button type="button" className="btn" aria-label={`Discard ${r.name}`} onClick={() => void discardRecovery(r.id)}>
                  Discard
                </button>
              </li>
            ),
          )}
        </ul>
      </div>
    </div>
  );
}

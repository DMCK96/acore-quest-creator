import type { ApiError } from '@shared/ipc';
import type { AppStore } from '../state/app-store';
import { PanelFrame } from '../modules/ModulePanel';

/** Statements are one per line, each ending in `;`; blank lines and comments never end that way. */
function countStatements(sql: string): number {
  return sql.split('\n').filter((line) => line.trim().endsWith(';')).length;
}

function ExportRefusal({ error }: { error: ApiError }): React.JSX.Element {
  if (error.code === 'VALIDATION' && error.issues) {
    return (
      <ul>
        {error.issues.map((issue, i) => (
          <li key={i}>{issue.message}</li>
        ))}
      </ul>
    );
  }
  // FIDELITY, ID_COLLISION and everything else: the API's own message is the whole refusal.
  return <p>{error.message}</p>;
}

/**
 * The workspace header's export controls: writing a `.sql` patch to disk, and applying it to an
 * opt-in dev database behind a confirmation dialog. Rendered once per open quest, in the header's
 * actions, so it is reachable from anywhere in the quest; what they report shows in
 * `ExportStatus`, under the header's bar.
 */
export function ExportBar({ store }: { store: AppStore }): React.JSX.Element | null {
  const open = store((s) => s.open);
  const hasDevProfile = store((s) => s.hasDevProfile);
  const pendingApply = store((s) => s.pendingApply);
  const exportQuest = store((s) => s.exportQuest);
  const prepareApply = store((s) => s.prepareApply);
  const confirmApply = store((s) => s.confirmApply);
  const cancelApply = store((s) => s.cancelApply);

  if (!open) return null;

  const unsafe = !open.fidelity.ok;
  const noDevHint = 'Add a dev database profile in Settings to enable this.';

  return (
    <>
      <button
        type="button"
        className="btn btn--primary"
        onClick={() => void exportQuest()}
        disabled={unsafe}
        title={unsafe ? 'Unsafe to export: this quest does not round-trip' : undefined}
      >
        Export patch
      </button>
      <button
        type="button"
        className="btn"
        onClick={() => void prepareApply()}
        disabled={!hasDevProfile}
        title={hasDevProfile ? undefined : noDevHint}
        aria-describedby={hasDevProfile ? undefined : 'export-no-dev'}
      >
        Apply to dev DB
      </button>
      {!hasDevProfile && (
        <span id="export-no-dev" className="visually-hidden">
          {noDevHint}
        </span>
      )}

      {pendingApply && (
        <PanelFrame
          title="Apply to dev DB"
          description={`${countStatements(pendingApply.sql)} statements will run in one transaction.`}
          onClose={cancelApply}
          footer={
            <>
              <span />
              <div className="export-apply__actions">
                <button type="button" className="btn" onClick={cancelApply}>
                  Cancel
                </button>
                <button type="button" className="btn btn--primary" onClick={() => void confirmApply()}>
                  Apply
                </button>
              </div>
            </>
          }
        >
          <pre className="export-apply__sql">{pendingApply.sql}</pre>
        </PanelFrame>
      )}
    </>
  );
}

/** What the last export or apply reported: the written path and its warnings, a refusal, or the applied count. */
export function ExportStatus({ store }: { store: AppStore }): React.JSX.Element | null {
  const exportResult = store((s) => s.exportResult);
  const exportError = store((s) => s.exportError);
  const appliedCount = store((s) => s.appliedCount);

  if (exportError) {
    return (
      <div className="export-status export-status--error" role="alert">
        <ExportRefusal error={exportError} />
      </div>
    );
  }
  if (!exportResult && appliedCount === null) return null;
  return (
    <div className="export-status" role="status">
      {exportResult && (
        <>
          <p>
            Patch written to <code>{exportResult.path}</code>
          </p>
          {exportResult.warnings.length > 0 && (
            <ul>
              {exportResult.warnings.map((w, i) => (
                <li key={i}>{w.message}</li>
              ))}
            </ul>
          )}
        </>
      )}
      {appliedCount !== null && <p>Applied {appliedCount} statements.</p>}
    </div>
  );
}

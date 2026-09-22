import type { ApiError } from '@shared/ipc';
import type { AppStore } from '../state/app-store';

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
 * opt-in dev database behind a confirmation dialog. Rendered once per open quest, above the tabs,
 * so it is reachable from any tab.
 */
export function ExportBar({ store }: { store: AppStore }): React.JSX.Element | null {
  const open = store((s) => s.open);
  const hasDevProfile = store((s) => s.hasDevProfile);
  const exportResult = store((s) => s.exportResult);
  const exportError = store((s) => s.exportError);
  const pendingApply = store((s) => s.pendingApply);
  const appliedCount = store((s) => s.appliedCount);
  const exportQuest = store((s) => s.exportQuest);
  const prepareApply = store((s) => s.prepareApply);
  const confirmApply = store((s) => s.confirmApply);
  const cancelApply = store((s) => s.cancelApply);

  if (!open) return null;

  const unsafe = !open.fidelity.ok;

  return (
    <div>
      <button
        type="button"
        onClick={() => void exportQuest()}
        disabled={unsafe}
        title={unsafe ? 'Unsafe to export: this quest does not round-trip' : undefined}
      >
        Export patch
      </button>
      <button type="button" onClick={() => void prepareApply()} disabled={!hasDevProfile}>
        Apply to dev DB
      </button>
      {!hasDevProfile && <p>Add a dev database profile to enable this.</p>}

      {exportError && <ExportRefusal error={exportError} />}
      {!exportError && exportResult && (
        <div>
          <p>{exportResult.path}</p>
          {exportResult.warnings.length > 0 && (
            <ul>
              {exportResult.warnings.map((w, i) => (
                <li key={i}>{w.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {!exportError && appliedCount !== null && <p>Applied {appliedCount} statements.</p>}

      {pendingApply && (
        <div role="dialog" aria-label="Apply to dev DB">
          <pre style={{ overflow: 'auto', maxHeight: 300 }}>{pendingApply.sql}</pre>
          <p>{countStatements(pendingApply.sql)} statements will run in one transaction.</p>
          <button type="button" onClick={cancelApply}>
            Cancel
          </button>
          <button type="button" onClick={() => void confirmApply()}>
            Apply
          </button>
        </div>
      )}
    </div>
  );
}

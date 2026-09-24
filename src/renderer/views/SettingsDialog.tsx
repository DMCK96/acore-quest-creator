import { useEffect, useState } from 'react';
import type { AppStore } from '../state/app-store';
import { ConnectionFields } from '../connection/ConnectionFields';
import { devChanged, draftFromProfiles, validateDraft, worldChanged, type ConnectionDraft, type DraftErrors } from '../connection/draft';
import './ProjectDialog.css';
import './SettingsDialog.css';

/**
 * The Settings modal: the same connection details as the login screen, changed without leaving
 * the work. A change to the world database (or its folders) saves and reconnects, closing any
 * open quest; a change to the dev database alone just saves. A failed reconnect keeps the old
 * connection and shows why here.
 */
export function SettingsDialog({ store, onClose }: { store: AppStore; onClose: () => void }): React.JSX.Element {
  const { saveConnection, reconnect, chooseServerDataDir } = store.getState();
  const [original] = useState<ConnectionDraft>(() => draftFromProfiles(store.getState().profiles));
  const [draft, setDraft] = useState<ConnectionDraft>(original);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const reconnects = worldChanged(draft, original);
  const changed = reconnects || devChanged(draft, original);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const found = validateDraft(draft);
    setErrors(found);
    const firstInvalid = Object.keys(found)[0];
    if (firstInvalid !== undefined) {
      document.getElementById(firstInvalid)?.focus();
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const saved = await saveConnection(draft, original);
      if (!saved.ok) {
        setError(saved.error);
        return;
      }
      if (reconnects) {
        const failed = await reconnect(saved.worldId);
        if (failed !== null) {
          setError(failed);
          return;
        }
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="modal settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        onSubmit={(e) => void submit(e)}
        noValidate
      >
        <header className="modal__header">
          <h2 id="settings-dialog-title">Settings</h2>
          <button type="button" className="btn btn--icon" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>

        <ConnectionFields draft={draft} onChange={setDraft} errors={errors} disabled={busy} browse={chooseServerDataDir} />

        {error && (
          <p className="settings-dialog__error" role="alert">
            {error}
          </p>
        )}

        <div className="settings-dialog__actions">
          {reconnects && <p className="settings-dialog__note">Reconnecting closes the open quest. Your project stays open.</p>}
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy || !changed}>
            {busy ? 'Saving…' : reconnects ? 'Save and reconnect' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}

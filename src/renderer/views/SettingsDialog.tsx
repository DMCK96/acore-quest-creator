import { useEffect, useRef, useState } from 'react';
import type { AppStore } from '../state/app-store';
import { ConnectionCard } from '../connection/ConnectionCard';
import { trapTab } from '../components/trap-tab';
import { devChanged, draftFromProfiles, validateDraft, worldChanged, type ConnectionDraft, type DraftErrors } from '../connection/draft';
import './ProjectDialog.css';
import './SettingsDialog.css';

/**
 * The Settings modal: the login screen's card, over the canvas, with Save for Connect. A change to
 * the world database (or its folders) saves and then reconnects: the new connection is opened
 * first and the old one closed only once it works, so a failed reconnect keeps the old connection
 * (and shows why here). Reconnecting closes any open quest. A change to the dev database alone
 * just saves.
 */
export function SettingsDialog({ store, onClose }: { store: AppStore; onClose: () => void }): React.JSX.Element {
  const { saveConnection, reconnect, chooseServerDataDir } = store.getState();
  const [original, setOriginal] = useState<ConnectionDraft>(() => draftFromProfiles(store.getState().profiles));
  const [draft, setDraft] = useState<ConnectionDraft>(original);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Saved but not yet connected with: the last reconnect failed, so Save offers it again.
  const [unconnected, setUnconnected] = useState(false);
  const dialog = useRef<HTMLFormElement | null>(null);

  // Closing mid-save would lose a failure nobody else shows.
  const close = (): void => {
    if (!busy) onClose();
  };

  // Focus moves in on opening and back to what opened it (the settings button) on closing.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  // Caught before anything else hears it: the quest editor behind also closes on Escape.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (!busy) onClose();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose, busy]);

  // Saving disables the fields, which drops focus out of the dialog: take it back when done.
  useEffect(() => {
    if (!busy && dialog.current && !dialog.current.contains(document.activeElement)) dialog.current.focus();
  }, [busy]);

  const reconnects = unconnected || worldChanged(draft, original);
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
        // What did save is kept, so a retry updates it; a saved world change is still to connect with.
        if (saved.saved && saved.original) {
          setOriginal(saved.original);
          setDraft(saved.saved);
          if (reconnects) setUnconnected(true);
        }
        return;
      }
      // Saving again (after a failed reconnect) updates these rows instead of adding more.
      setOriginal(saved.saved);
      setDraft(saved.saved);
      if (reconnects) {
        const failed = await reconnect(saved.worldId);
        setUnconnected(failed !== null);
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
    <div className="modal-backdrop settings-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <ConnectionCard
        formRef={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        tabIndex={-1}
        onKeyDown={(e) => trapTab(e, dialog.current)}
        onSubmit={(e) => void submit(e)}
        title="Settings"
        titleId="settings-dialog-title"
        subtitle="Your AzerothCore world database connection."
        error={error}
        note={reconnects ? 'Saving reconnects with these details and closes the open quest. Your project stays open.' : null}
        submitLabel={busy ? 'Saving…' : 'Save'}
        submitDisabled={!changed}
        busy={busy}
        onClose={close}
        draft={draft}
        onChange={setDraft}
        errors={errors}
        browse={chooseServerDataDir}
      />
    </div>
  );
}

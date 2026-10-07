import { useEffect, useState } from 'react';
import { ConnectionCard } from '../../connection/ConnectionCard';
import { devChanged, draftFromProfiles, validateDraft, worldChanged, type ConnectionDraft, type DraftErrors } from '../../connection/draft';
import type { SettingsSectionProps } from './sections';

/**
 * The login screen's card with Save for Connect. A change to the world database (or its folders)
 * saves and then reconnects: the new connection is opened first and the old one closed only once
 * it works, so a failed reconnect keeps the old connection (and shows why here). Reconnecting
 * closes any open quest. A change to the dev database alone just saves.
 */
export function ConnectionSection({ store, onClose, setBusy: reportBusy }: SettingsSectionProps): React.JSX.Element {
  const { saveConnection, reconnect, chooseServerDataDir } = store.getState();
  const [original, setOriginal] = useState<ConnectionDraft>(() => draftFromProfiles(store.getState().profiles));
  const [draft, setDraft] = useState<ConnectionDraft>(original);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Saved but not yet connected with: the last reconnect failed, so Save offers it again.
  const [unconnected, setUnconnected] = useState(false);

  useEffect(() => reportBusy(busy), [busy, reportBusy]);

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
    <ConnectionCard
      onSubmit={(e) => void submit(e)}
      title="Settings"
      titleId="settings-dialog-title"
      subtitle="Your AzerothCore world database connection."
      error={error}
      note={reconnects ? 'Saving reconnects with these details and closes the open quest. Your project stays open.' : null}
      submitLabel={busy ? 'Saving…' : 'Save'}
      submitDisabled={!changed}
      busy={busy}
      draft={draft}
      onChange={setDraft}
      errors={errors}
      browse={chooseServerDataDir}
    />
  );
}

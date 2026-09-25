import { useEffect, useState } from 'react';
import type { AppStore } from '../state/app-store';
import { QuestOrb } from '../components/QuestOrb';
import { ConnectionFields } from '../connection/ConnectionFields';
import { draftFromProfiles, validateDraft, type ConnectionDraft, type DraftErrors } from '../connection/draft';
import './LoginScreen.css';

/**
 * The first screen of every launch that is not set up by `.env`: the connection details on a card
 * over the orb. A first launch fills them in and saves them; later launches find them filled in
 * and lead with Connect.
 */
export function LoginScreen({ store }: { store: AppStore }): React.JSX.Element {
  const profiles = store((s) => s.profiles);
  const storeError = store((s) => s.error);
  const { saveConnection, connectProfile, chooseServerDataDir } = store.getState();

  const [original, setOriginal] = useState<ConnectionDraft>(() => draftFromProfiles(profiles));
  const [draft, setDraft] = useState<ConnectionDraft>(original);
  const [touched, setTouched] = useState(false);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [localError, setLocalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Launch lists the saved profiles after this screen mounts: take them up until the user types.
  useEffect(() => {
    if (touched) return;
    const fresh = draftFromProfiles(profiles);
    setOriginal(fresh);
    setDraft(fresh);
    // Only a new profile list resets the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles]);

  const edit = (next: ConnectionDraft): void => {
    setTouched(true);
    setDraft(next);
  };

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const found = validateDraft(draft);
    setErrors(found);
    const firstInvalid = Object.keys(found)[0];
    if (firstInvalid !== undefined) {
      document.getElementById(firstInvalid)?.focus();
      return;
    }
    setLocalError(null);
    setBusy(true);
    try {
      const saved = await saveConnection(draft, original);
      if (!saved.ok) {
        setLocalError(saved.error);
        return;
      }
      // A retry after a failed connect updates these rows instead of adding more.
      setOriginal(saved.saved);
      setDraft(saved.saved);
      await connectProfile(saved.worldId);
    } finally {
      setBusy(false);
    }
  };

  const returning = original.world.id !== undefined;
  const error = localError ?? storeError;

  return (
    <main className="login">
      <div className="login__orb" aria-hidden="true">
        <QuestOrb />
      </div>
      <form className="login__card" onSubmit={(e) => void submit(e)} noValidate>
        <header className="login__header">
          <h1 className="login__title">ACORE Quest Creator</h1>
          <p className="login__subtitle">Connect to your AzerothCore world database.</p>
        </header>
        {error && (
          <p className="login__error" role="alert">
            {error}
          </p>
        )}
        <ConnectionFields draft={draft} onChange={edit} errors={errors} disabled={busy} browse={chooseServerDataDir} />
        <button type="submit" className="btn btn--primary login__submit" disabled={busy}>
          {busy ? 'Connecting…' : returning ? 'Connect' : 'Save and connect'}
        </button>
      </form>
    </main>
  );
}

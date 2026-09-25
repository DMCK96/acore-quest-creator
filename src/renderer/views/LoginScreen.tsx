import { useEffect, useRef, useState } from 'react';
import type { AppStore } from '../state/app-store';
import { QuestOrb } from '../components/QuestOrb';
import { ConnectionFields } from '../connection/ConnectionFields';
import { draftFromProfiles, validateDraft, type ConnectionDraft, type DraftErrors } from '../connection/draft';
import './LoginScreen.css';

/**
 * The first screen of every launch: the connection details on a card over the orb. A first launch
 * fills them in and saves them; later launches (and `.env` ones) find them filled in and lead with
 * Connect. Connecting morphs the orb into the one on the empty canvas (see `App`).
 */
export function LoginScreen({
  store,
  leaving = false,
  onLeft,
}: {
  store: AppStore;
  /** Connected: the card fades, and the orb spins and shrinks onto the empty canvas's orb. */
  leaving?: boolean;
  /** Called once the leaving animation has finished. */
  onLeft?: () => void;
}): React.JSX.Element {
  const profiles = store((s) => s.profiles);
  const startupProfileId = store((s) => s.startupProfileId);
  const storeError = store((s) => s.error);
  const { saveConnection, connectProfile, chooseServerDataDir } = store.getState();

  const [original, setOriginal] = useState<ConnectionDraft>(() => draftFromProfiles(profiles, startupProfileId));
  const [draft, setDraft] = useState<ConnectionDraft>(original);
  const [touched, setTouched] = useState(false);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [localError, setLocalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const orbRef = useRef<HTMLDivElement | null>(null);
  const onLeftRef = useRef(onLeft);
  onLeftRef.current = onLeft;

  useEffect(() => {
    if (!leaving) return;
    const orb = orbRef.current;
    const done = (): void => onLeftRef.current?.();
    // jsdom (tests) has no Web Animations.
    if (!orb || typeof orb.animate !== 'function') {
      done();
      return;
    }
    const from = orb.getBoundingClientRect();
    // With quests on the canvas there is no orb to land on: it shrinks away where it is.
    const target = document.querySelector('.canvas-empty__circle .quest-orb')?.getBoundingClientRect();
    const dx = target ? target.left + target.width / 2 - (from.left + from.width / 2) : 0;
    const dy = target ? target.top + target.height / 2 - (from.top + from.height / 2) : 0;
    const scale = target ? target.width / from.width : 0.2;
    const animation = orb.animate(
      [
        { transform: 'translate(-50%, -50%) rotate(0turn) scale(1)', opacity: 1 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(1turn) scale(${scale})`, opacity: target ? 1 : 0 },
      ],
      { duration: 1100, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', fill: 'forwards' },
    );
    animation.finished.then(done, done);
    return () => animation.cancel();
  }, [leaving]);

  // Launch lists the saved profiles after this screen mounts: take them up until the user types.
  // Once they have typed, what they typed stays, but it is saved over the saved rows, not beside them.
  useEffect(() => {
    const fresh = draftFromProfiles(profiles, startupProfileId);
    setOriginal(fresh);
    setDraft(touched ? (d) => adoptSaved(d, fresh) : fresh);
    // Only a new profile list resets the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles, startupProfileId]);

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
        // What did save is kept, so a retry updates it rather than adding another.
        if (saved.saved && saved.original) {
          setOriginal(saved.original);
          setDraft(saved.saved);
        }
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
    <main className={leaving ? 'login login--leaving' : 'login'} aria-hidden={leaving || undefined}>
      <div ref={orbRef} className="login__orb" aria-hidden="true">
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

/**
 * The typed draft pointed at the saved rows: it takes their IDs and names, and a saved dev database
 * the user had not added is kept rather than read as removed.
 */
function adoptSaved(draft: ConnectionDraft, saved: ConnectionDraft): ConnectionDraft {
  const world = draft.world.id === undefined && saved.world.id !== undefined
    ? { ...draft.world, id: saved.world.id, name: saved.world.name }
    : draft.world;
  let dev = draft.dev;
  if (saved.dev) {
    if (dev === null) dev = saved.dev;
    else if (dev.id === undefined) dev = { ...dev, id: saved.dev.id, name: saved.dev.name };
  }
  return { world, dev };
}

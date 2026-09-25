import { useEffect, useRef } from 'react';
import { emptyDev, type ConnectionDraft, type DbFields, type DraftErrors } from './draft';
import './ConnectionFields.css';

const SAVED_PASSWORD = 'Saved — leave blank to keep';

/**
 * The connection details, shared by the login screen and Settings: the world database, its game
 * files (the server data and game client folders), and an optional dev database. Controlled: every
 * edit goes out through `onChange`; the shell owns the draft and the buttons.
 */
export function ConnectionFields({
  draft,
  onChange,
  errors,
  disabled = false,
  browse,
}: {
  draft: ConnectionDraft;
  onChange: (draft: ConnectionDraft) => void;
  errors: DraftErrors;
  disabled?: boolean;
  /** The folder picker; resolves null when cancelled. */
  browse: () => Promise<string | null>;
}): React.JSX.Element {
  const { world, dev } = draft;
  const setWorld = (patch: Partial<ConnectionDraft['world']>): void => onChange({ ...draft, world: { ...world, ...patch } });
  const setDev = (patch: Partial<DbFields>): void => {
    if (dev) onChange({ ...draft, dev: { ...dev, ...patch } });
  };
  // Adding or removing the dev database swaps out the button just pressed; focus follows to what
  // replaced it rather than falling out of the form.
  const focusNext = useRef<string | null>(null);
  const hasDev = dev !== null;
  useEffect(() => {
    if (focusNext.current === null) return;
    document.getElementById(focusNext.current)?.focus();
    focusNext.current = null;
  }, [hasDev]);
  const setHasDev = (on: boolean): void => {
    focusNext.current = on ? 'conn-dev-host' : 'conn-dev-add';
    onChange({ ...draft, dev: on ? emptyDev() : null });
  };
  const browseInto = async (key: 'dbcDir' | 'clientDir'): Promise<void> => {
    const chosen = await browse();
    if (chosen !== null) setWorld({ [key]: chosen });
  };

  return (
    <div className="conn-fields">
      <fieldset className="conn-fields__section" disabled={disabled}>
        <legend>World database</legend>
        <p className="conn-field__help">
          Your server&rsquo;s world database, usually acore_world. Quests, NPCs, items and the rest are read from it to
          import and to check your work against. It is never written to: your changes go to SQL you export.
        </p>
        <DbInputs prefix="conn-" labelPrefix="" db={world} saved={world.id !== undefined} errors={errors} onChange={setWorld} />
      </fieldset>

      <fieldset className="conn-fields__section" disabled={disabled}>
        <legend>Game files (optional)</legend>
        <Field id="conn-dbc-dir" label="Server data folder (optional)" errors={errors} help="The worldserver's data folder, the one holding dbc/. With it the editor can show values the server reads from its DBC files, such as how much XP each quest reward tier gives. Everything works without it.">
          {(props) => (
            <div className="conn-field__row">
              <input {...props} value={world.dbcDir} placeholder="e.g. /home/acore/server/data" onChange={(e) => setWorld({ dbcDir: e.target.value })} />
              <button type="button" className="btn" aria-label="Browse for the server data folder" onClick={() => void browseInto('dbcDir')}>
                Browse…
              </button>
            </div>
          )}
        </Field>
        <Field id="conn-client-dir" label="Game client folder (optional)" errors={errors} help="The folder with Wow.exe. The map uses its zone art and minimap.">
          {(props) => (
            <div className="conn-field__row">
              <input {...props} value={world.clientDir} placeholder="e.g. E:\Games\World of Warcraft" onChange={(e) => setWorld({ clientDir: e.target.value })} />
              <button type="button" className="btn" aria-label="Browse for the game client folder" onClick={() => void browseInto('clientDir')}>
                Browse…
              </button>
            </div>
          )}
        </Field>
      </fieldset>

      <fieldset className="conn-fields__section" disabled={disabled}>
        <legend>Dev database (optional)</legend>
        {dev === null ? (
          <>
            <p className="conn-field__help">Where &ldquo;Apply to dev DB&rdquo; writes a quest to try it on a test server.</p>
            <button type="button" id="conn-dev-add" className="btn" onClick={() => setHasDev(true)}>
              Add a dev database
            </button>
          </>
        ) : (
          <>
            <DbInputs prefix="conn-dev-" labelPrefix="Dev " db={dev} saved={dev.id !== undefined} errors={errors} onChange={setDev} />
            <button type="button" className="btn conn-fields__remove" onClick={() => setHasDev(false)}>
              Remove dev database
            </button>
          </>
        )}
      </fieldset>
    </div>
  );
}

/** Host and port, user and password, then the database name. */
function DbInputs({
  prefix,
  labelPrefix,
  db,
  saved,
  errors,
  onChange,
}: {
  prefix: string;
  labelPrefix: string;
  db: DbFields;
  saved: boolean;
  errors: DraftErrors;
  onChange: (patch: Partial<DbFields>) => void;
}): React.JSX.Element {
  // "Host" for the world, "Dev host" for the dev database.
  const label = (name: string): string => (labelPrefix === '' ? name : labelPrefix + name.toLowerCase());
  return (
    <>
      <div className="conn-fields__pair conn-fields__pair--port">
        <Field id={`${prefix}host`} label={label('Host')} errors={errors}>
          {(props) => <input {...props} value={db.host} onChange={(e) => onChange({ host: e.target.value })} />}
        </Field>
        <Field id={`${prefix}port`} label={label('Port')} errors={errors}>
          {(props) => <input {...props} inputMode="numeric" value={db.port} onChange={(e) => onChange({ port: e.target.value })} />}
        </Field>
      </div>
      <div className="conn-fields__pair">
        <Field id={`${prefix}user`} label={label('User')} errors={errors}>
          {(props) => <input {...props} value={db.user} onChange={(e) => onChange({ user: e.target.value })} />}
        </Field>
        <Field id={`${prefix}password`} label={label('Password')} errors={errors}>
          {(props) => (
            <input
              {...props}
              type="password"
              value={db.password}
              placeholder={saved ? SAVED_PASSWORD : undefined}
              onChange={(e) => onChange({ password: e.target.value })}
            />
          )}
        </Field>
      </div>
      <Field id={`${prefix}database`} label={label('Database')} errors={errors}>
        {(props) => <input {...props} value={db.database} onChange={(e) => onChange({ database: e.target.value })} />}
      </Field>
    </>
  );
}

interface InputProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
}

/** A labelled input with its optional help and its error, both tied to it for screen readers. */
function Field({
  id,
  label,
  help,
  errors,
  children,
}: {
  id: string;
  label: string;
  help?: string;
  errors: DraftErrors;
  children: (props: InputProps) => React.ReactNode;
}): React.JSX.Element {
  const error = errors[id];
  const describedBy = [help ? `${id}-help` : null, error ? `${id}-error` : null].filter(Boolean).join(' ');
  return (
    <div className="conn-field">
      <label htmlFor={id}>{label}</label>
      {help && (
        <p id={`${id}-help`} className="conn-field__help">
          {help}
        </p>
      )}
      {children({ id, ...(describedBy ? { 'aria-describedby': describedBy } : {}), ...(error ? { 'aria-invalid': true } : {}) })}
      {error && (
        <p id={`${id}-error`} className="conn-field__error">
          {error}
        </p>
      )}
    </div>
  );
}

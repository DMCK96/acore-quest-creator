import { useEffect, useState } from 'react';
import type { DebugStatus } from '@shared/ipc';
import { usePreferences } from '../../preferences/usePreferences';
import type { DockSide } from '../../preferences/store';
import type { SettingsSectionProps } from './sections';

const DOCK_CHOICES: readonly { side: DockSide; label: string }[] = [
  { side: 'bottom', label: 'Under the world' },
  { side: 'right', label: 'Beside the world' },
];

/** Local preferences: each change applies at once, so there is no Save. */
export function PreferencesSection(_props: SettingsSectionProps): React.JSX.Element {
  const [preferences, update] = usePreferences();
  const [debug, setDebug] = useState<DebugStatus | null>(null);
  const [debugError, setDebugError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void window.api?.debugStatus().then((r) => {
      if (live && r.ok) setDebug(r.value);
    });
    return () => {
      live = false;
    };
  }, []);

  const switchDebug = async (on: boolean): Promise<void> => {
    setDebugError(null);
    const r = await window.api.debugSetEnabled(on);
    if (r.ok) setDebug(r.value);
    else setDebugError(r.error.message);
  };

  return (
    <div className="settings-prefs">
      <h2 className="settings-prefs__heading">Layout</h2>
      <fieldset className="settings-prefs__group">
        <legend>Quest dock</legend>
        {DOCK_CHOICES.map(({ side, label }) => (
          <label key={side} className="settings-prefs__choice">
            <input type="radio" name="dock-side" checked={preferences.dockSide === side} onChange={() => update({ dockSide: side })} />
            {label}
          </label>
        ))}
      </fieldset>

      <h2 className="settings-prefs__heading">Diagnostics</h2>
      <div className="settings-prefs__group">
        <label className="settings-prefs__choice">
          <input type="checkbox" checked={debug?.enabled ?? false} disabled={debug === null} onChange={(e) => void switchDebug(e.target.checked)} />
          Debug mode
        </label>
        <p className="settings-prefs__note">
          Records key codes and focus changes, window and dialog events, and errors, so a problem like text fields that stop typing can be traced; never the characters you type or what is in a field.
        </p>
        {debug?.logFile && <p className="settings-prefs__note">Log file: {debug.logFile}</p>}
        {debugError && (
          <p className="settings-prefs__error" role="alert">
            {debugError}
          </p>
        )}
      </div>
    </div>
  );
}

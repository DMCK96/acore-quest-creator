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
    </div>
  );
}

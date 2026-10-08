import type { AppStore } from '../../state/app-store';
import { ConnectionSection } from './ConnectionSection';
import { McpSection } from './McpSection';
import { PreferencesSection } from './PreferencesSection';

export interface SettingsSectionProps {
  store: AppStore;
  onClose: () => void;
  /** A section mid-save says so, and the dialog will not close until it is done. */
  setBusy: (busy: boolean) => void;
}

/** One tab of the Settings dialog. Adding a section is adding an entry here. */
export interface SettingsSection {
  id: string;
  title: string;
  Component: (props: SettingsSectionProps) => React.JSX.Element;
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: 'connection', title: 'Connection', Component: ConnectionSection },
  { id: 'preferences', title: 'Preferences', Component: PreferencesSection },
  { id: 'claude', title: 'Claude', Component: McpSection },
];

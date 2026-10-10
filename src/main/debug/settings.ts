import type { Store } from '../store/store';

const ENABLED = 'debug.enabled';

/**
 * Whether Debug mode is on. Kept in the main store, not the window's own preferences, because the main
 * process has to know it too. Off by default.
 */
export interface DebugSettings {
  enabled(): boolean;
  setEnabled(on: boolean): void;
}

export function createDebugSettings(store: Store): DebugSettings {
  return {
    enabled: () => store.settings.get(ENABLED) === '1',
    setEnabled: (on) => store.settings.set(ENABLED, on ? '1' : '0'),
  };
}

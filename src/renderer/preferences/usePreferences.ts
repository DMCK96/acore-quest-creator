import { useCallback, useSyncExternalStore } from 'react';
import { getPreferencesSnapshot, subscribePreferences, writePreferences, type Preferences } from './store';

export function usePreferences(): [Preferences, (patch: Partial<Preferences>) => void] {
  const preferences = useSyncExternalStore(subscribePreferences, getPreferencesSnapshot);
  const update = useCallback((patch: Partial<Preferences>) => {
    writePreferences({ ...getPreferencesSnapshot(), ...patch });
  }, []);
  return [preferences, update];
}

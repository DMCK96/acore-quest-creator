import { useEffect, useMemo, useState } from 'react';
import { createAppStore, type AppState } from './state/app-store';
import { LoginScreen } from './views/LoginScreen';
import { CanvasHome } from './views/CanvasHome';
import { NamesProvider, localNamesOf } from './state/names';
import { RewardTablesProvider } from './state/reward-tables';
import './App.css';

const inApp = (screen: AppState['screen']): boolean => screen === 'pick' || screen === 'preview' || screen === 'edit';

export function App(): React.JSX.Element {
  const store = useMemo(() => createAppStore(window.api), []);
  const screen = store((s) => s.screen);
  const connection = store((s) => s.connection);
  // The open quest's new NPCs and objects, named in pickers before the main process has them.
  const openValues = store((s) => s.open?.aggregate.values);
  const local = useMemo(() => localNamesOf(openValues), [openValues]);
  // Connecting from the login screen keeps it on top of the canvas for a moment while it leaves:
  // its orb spins down into the canvas's (see LoginScreen's `leaving`).
  const [leaving, setLeaving] = useState(false);
  const [shown, setShown] = useState(screen);
  if (shown !== screen) {
    setShown(screen);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    setLeaving(shown === 'connect' && inApp(screen) && !reduced);
  }

  useEffect(() => {
    void store.getState().start();
    // Closing the window asks for pending edits first, so the unsaved-changes check sees them.
    window.appEvents?.onFlushRequest(() => store.getState().flushAll());
  }, [store]);

  // Both stay in the same slots, so the login screen is not remounted when the canvas appears.
  return (
    <>
      {inApp(screen) && (
        <div className={leaving ? 'app-arriving' : undefined} style={{ display: 'contents' }}>
          <NamesProvider api={window.api} epoch={connection} local={local}>
            <RewardTablesProvider api={window.api} epoch={connection}>
              <CanvasHome store={store} />
            </RewardTablesProvider>
          </NamesProvider>
        </div>
      )}
      {(!inApp(screen) || leaving) && <LoginScreen store={store} leaving={leaving} onLeft={() => setLeaving(false)} />}
    </>
  );
}

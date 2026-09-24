import { useEffect, useMemo } from 'react';
import { createAppStore } from './state/app-store';
import { LoginScreen } from './views/LoginScreen';
import { CanvasHome } from './views/CanvasHome';
import { NamesProvider } from './state/names';
import { RewardTablesProvider } from './state/reward-tables';

export function App(): React.JSX.Element {
  const store = useMemo(() => createAppStore(window.api), []);
  const screen = store((s) => s.screen);

  useEffect(() => {
    void store.getState().start();
    // Closing the window asks for pending edits first, so the unsaved-changes check sees them.
    window.appEvents?.onFlushRequest(() => store.getState().flushAll());
  }, [store]);

  if (screen === 'pick' || screen === 'preview' || screen === 'edit') {
    return (
      <NamesProvider api={window.api}>
        <RewardTablesProvider api={window.api}>
          <CanvasHome store={store} />
        </RewardTablesProvider>
      </NamesProvider>
    );
  }
  return <LoginScreen store={store} />;
}

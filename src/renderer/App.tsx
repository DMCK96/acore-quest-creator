import { useEffect, useMemo } from 'react';
import { createAppStore } from './state/app-store';
import { ConnectionScreen } from './views/ConnectionScreen';
import { CanvasHome } from './views/CanvasHome';
import { NamesProvider } from './state/names';
import { RewardTablesProvider } from './state/reward-tables';

export function App(): React.JSX.Element {
  const store = useMemo(() => createAppStore(window.api), []);
  const screen = store((s) => s.screen);

  useEffect(() => {
    void store.getState().start();
  }, [store]);

  if (screen === 'pick' || screen === 'edit') {
    return (
      <NamesProvider api={window.api}>
        <RewardTablesProvider api={window.api}>
          <CanvasHome store={store} />
        </RewardTablesProvider>
      </NamesProvider>
    );
  }
  return <ConnectionScreen store={store} />;
}

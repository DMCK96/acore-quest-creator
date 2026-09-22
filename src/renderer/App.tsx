import { useMemo } from 'react';
import { createAppStore } from './state/app-store';
import { ConnectionScreen } from './views/ConnectionScreen';
import { CanvasHome } from './views/CanvasHome';

export function App(): React.JSX.Element {
  const store = useMemo(() => createAppStore(window.api), []);
  const screen = store((s) => s.screen);

  if (screen === 'pick' || screen === 'edit') return <CanvasHome store={store} />;
  return <ConnectionScreen store={store} />;
}

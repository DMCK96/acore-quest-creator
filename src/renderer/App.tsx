import { useMemo } from 'react';
import { createAppStore } from './state/app-store';
import { ConnectionScreen } from './views/ConnectionScreen';
import { QuestPicker } from './views/QuestPicker';
import { QuestWorkspace } from './views/QuestWorkspace';

export function App(): React.JSX.Element {
  const store = useMemo(() => createAppStore(window.api), []);
  const screen = store((s) => s.screen);

  if (screen === 'pick') return <QuestPicker store={store} />;
  if (screen === 'edit') return <QuestWorkspace store={store} />;
  return <ConnectionScreen store={store} />;
}

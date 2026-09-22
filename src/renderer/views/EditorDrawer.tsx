import { useEffect, useState } from 'react';
import type { AppStore } from '../state/app-store';
import { QuestWorkspace } from './QuestWorkspace';

/** The editor as a drawer over the canvas: the canvas stays mounted and interactive beside it. */
export function EditorDrawer({ store }: { store: AppStore }): React.JSX.Element {
  const closeEditor = store((s) => s.closeEditor);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') void closeEditor();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [closeEditor]);

  return (
    <div
      role="complementary"
      aria-label="Quest editor"
      style={{ width: expanded ? '100%' : '55%', height: '100%', overflow: 'auto' }}
    >
      <div>
        <button type="button" aria-pressed={expanded} onClick={() => setExpanded((v) => !v)}>
          Expand editor
        </button>
        <button type="button" onClick={() => void closeEditor()}>
          Close editor
        </button>
      </div>
      <QuestWorkspace store={store} />
    </div>
  );
}

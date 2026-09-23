import { useEffect, useState } from 'react';
import type { AppStore } from '../state/app-store';
import { QuestWorkspace } from './QuestWorkspace';
import './EditorDrawer.css';

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
      className="editor-drawer"
      style={{ width: expanded ? '100%' : '55%' }}
    >
      <div className="editor-drawer__bar">
        <button type="button" className="btn" aria-pressed={expanded} onClick={() => setExpanded((v) => !v)}>
          Expand editor
        </button>
        <button type="button" className="btn" onClick={() => void closeEditor()}>
          Close editor
        </button>
      </div>
      <div className="editor-drawer__body">
        <QuestWorkspace store={store} />
      </div>
    </div>
  );
}

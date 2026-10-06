import { useEffect, useRef } from 'react';
import type { AppStore } from '../state/app-store';
import { trapTab } from '../components/trap-tab';
import { QuestFlowView } from './QuestFlowView';
import './ProjectDialog.css';
import './QuestEditorModal.css';

/**
 * The quest editor in a centred modal over the world: the module boxes and the panel of the one
 * being edited. Nothing renders unless a quest is being edited. Escape is not heard here:
 * QuestFlowView decides it (an inner panel or the entity editor closes first, the editor last), so
 * there is one place that does. Settings, opened on top, catches Escape before either.
 */
export function QuestEditorModal({ store }: { store: AppStore }): React.JSX.Element | null {
  const editing = store((s) => s.screen === 'edit');
  return editing ? <EditorDialog store={store} /> : null;
}

function EditorDialog({ store }: { store: AppStore }): React.JSX.Element {
  const dialog = useRef<HTMLDivElement | null>(null);

  // Focus moves in on opening and back to what opened it on closing.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  return (
    <div className="modal-backdrop quest-editor-backdrop" onMouseDown={(e) => e.target === e.currentTarget && void store.getState().backToChain()}>
      <div
        ref={dialog}
        className="quest-editor-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quest-editor-modal-title"
        tabIndex={-1}
        onKeyDown={(e) => trapTab(e, dialog.current)}
      >
        <h2 id="quest-editor-modal-title" className="quest-editor-modal__title">
          Edit quest
        </h2>
        <QuestFlowView store={store} />
      </div>
    </div>
  );
}

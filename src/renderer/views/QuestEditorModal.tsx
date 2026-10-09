import { useEffect, useRef } from 'react';
import type { AppStore } from '../state/app-store';
import { trapTab } from '../components/trap-tab';
import { QuestFlowView } from './QuestFlowView';
import { PlaceInWorldProvider, ShowInWorldProvider, useAsideForWorld } from '../world3d/ShowInWorldContext';
import './ProjectDialog.css';
import './QuestEditorModal.css';

/**
 * The quest editor in a centred modal over the world: the module boxes and the panel of the one
 * being edited. Nothing renders unless a quest is being edited. Escape is not heard here:
 * QuestFlowView decides it (an inner panel or the entity editor closes first, the editor last), so
 * there is one place that does. Settings, opened on top, catches Escape before either. While the
 * author places, draws or looks (Show in World, Go to) in the World from inside it, it steps aside,
 * keeping its panel and editor, and comes back once they are done.
 */
export function QuestEditorModal({ store }: { store: AppStore }): React.JSX.Element | null {
  const editing = store((s) => s.screen === 'edit');
  return editing ? <EditorDialog store={store} /> : null;
}

function EditorDialog({ store }: { store: AppStore }): React.JSX.Element {
  const dialog = useRef<HTMLDivElement | null>(null);
  const [aside, placeInWorld, showInWorld] = useAsideForWorld();
  const wasAside = useRef(false);
  const aiWriting = store((s) => s.aiWriting);

  // Focus moves in on opening and back to what opened it on closing.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  // Back from the World: focus comes back in
  useEffect(() => {
    if (aside) wasAside.current = true;
    else if (wasAside.current) dialog.current?.focus();
  }, [aside]);

  // Focus inside the greyed-out part would be lost with it: it waits on the dialog itself
  useEffect(() => {
    if (aiWriting) dialog.current?.focus();
  }, [aiWriting]);

  return (
    <PlaceInWorldProvider value={placeInWorld}>
    <ShowInWorldProvider value={showInWorld}>
    <div className="modal-backdrop quest-editor-backdrop" hidden={aside} onMouseDown={(e) => e.target === e.currentTarget && void store.getState().backToChain()}>
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
        {aiWriting && (
          <p className="quest-editor-modal__writing" role="status">
            The assistant is changing this quest. Editing is paused for a moment.
          </p>
        )}
        <div className={aiWriting ? 'quest-editor-modal__body quest-editor-modal__body--paused' : 'quest-editor-modal__body'} inert={aiWriting || undefined}>
          <QuestFlowView store={store} />
        </div>
      </div>
    </div>
    </ShowInWorldProvider>
    </PlaceInWorldProvider>
  );
}

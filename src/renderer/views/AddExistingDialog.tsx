import { useEffect, useRef } from 'react';
import { useReactFlow } from '@xyflow/react';
import type { AppStore } from '../state/app-store';
import { QuestPicker } from './QuestPicker';
import { trapTab } from '../components/trap-tab';
import './ProjectDialog.css';
import './AddExistingDialog.css';

/**
 * A small modal over the dimmed canvas around `QuestPicker`'s search: choosing a result adds that
 * quest *and every quest chained to it*, with the chosen one at the centre of the current viewport
 * and its editor open, instead of `QuestPicker`'s own default of opening the one quest wherever the
 * API puts it.
 */
export function AddExistingDialog({ store, onClose }: { store: AppStore; onClose: () => void }): React.JSX.Element {
  const addQuestChain = store((s) => s.addQuestChain);
  const { screenToFlowPosition } = useReactFlow();
  const dialog = useRef<HTMLDivElement | null>(null);

  // Opens on a fresh search, and hands focus back to what opened it on closing.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    void store.getState().search('');
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, [store]);

  // Caught before anything else hears it, so nothing behind the modal closes too.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  const handleSelect = (id: number): void => {
    const center = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    void addQuestChain(id, center);
    onClose();
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialog}
        className="modal add-existing"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-existing-title"
        onKeyDown={(e) => trapTab(e, dialog.current)}
      >
        <header className="modal__header">
          <h2 id="add-existing-title">Add existing quest chain</h2>
          <button type="button" className="btn btn--icon" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        <p className="add-existing__hint">Adds the quest you pick and every quest chained to it.</p>
        <QuestPicker store={store} onSelect={handleSelect} showNewQuestButton={false} autoFocus />
      </div>
    </div>
  );
}

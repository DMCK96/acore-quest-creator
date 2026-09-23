import { useReactFlow } from '@xyflow/react';
import type { AppStore } from '../state/app-store';
import { QuestPicker } from './QuestPicker';

/**
 * A modal wrapper around `QuestPicker`'s search list: choosing a result adds that quest *and every
 * quest chained to it*, with the chosen one at the centre of the current viewport and its editor
 * open, instead of `QuestPicker`'s own default of opening the one quest wherever the API puts it.
 */
export function AddExistingDialog({ store, onClose }: { store: AppStore; onClose: () => void }): React.JSX.Element {
  const addQuestChain = store((s) => s.addQuestChain);
  const { screenToFlowPosition } = useReactFlow();

  const handleSelect = (id: number): void => {
    const center = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    void addQuestChain(id, center);
    onClose();
  };

  return (
    <div role="dialog" aria-label="Add existing quest">
      <button type="button" onClick={onClose}>
        Cancel
      </button>
      <QuestPicker store={store} onSelect={handleSelect} showNewQuestButton={false} />
    </div>
  );
}

import { useReactFlow } from '@xyflow/react';
import type { AppStore } from '../state/app-store';
import { QuestPicker } from './QuestPicker';

/**
 * A modal wrapper around `QuestPicker`'s search list: choosing a result places that quest at the
 * centre of the current viewport and opens its editor, instead of `QuestPicker`'s own default of
 * opening wherever the API happens to put it.
 */
export function AddExistingDialog({ store, onClose }: { store: AppStore; onClose: () => void }): React.JSX.Element {
  const openQuest = store((s) => s.openQuest);
  const { screenToFlowPosition } = useReactFlow();

  const handleSelect = (id: number): void => {
    const center = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    void openQuest(id, center);
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

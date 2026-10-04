import { useRef } from 'react';
import type { TeleportSpot } from '@core/map/teleports';
import { trapTab } from '../components/trap-tab';
import { TeleportPicker } from './TeleportPicker';
import '../views/ProjectDialog.css';

/** The Teleport panel: the list of named places in a modal */
export function TeleportDialog({ onPick, onClose }: { onPick(spot: TeleportSpot): void; onClose(): void }): React.JSX.Element {
  const dialog = useRef<HTMLDivElement>(null);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={dialog} className="modal teleport" role="dialog" aria-modal="true" aria-label="Teleport" onKeyDown={(e) => trapTab(e, dialog.current)}>
        <header className="modal__header">
          <h2>Teleport</h2>
          <button type="button" className="btn btn--icon" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        <TeleportPicker onPick={onPick} autoFocus />
      </div>
    </div>
  );
}

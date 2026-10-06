import { useRef, useState } from 'react';
import type { SpawnEvents } from '@core/entities/model';
import { trapTab } from '../components/trap-tab';
import type { GameEvent } from '../controls/EventPicker';
import { EventRuleField } from '../entities/EventRuleField';
import '../views/ProjectDialog.css';

/**
 * Changes which game events NPC spawns follow of their own. It starts from their setting when they
 * share one, and with nothing chosen when they differ (`'mixed'`); Apply keeps the choice, once it is a
 * whole one.
 */
export function EventDialog({
  names,
  initial,
  events,
  onApply,
  onClose,
}: {
  names: string[];
  initial: SpawnEvents | 'mixed';
  events: readonly GameEvent[];
  onApply(to: SpawnEvents): void;
  onClose(): void;
}): React.JSX.Element {
  const dialog = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState<SpawnEvents | 'mixed'>(initial);
  const [pending, setPending] = useState(false);
  const who = names.length === 1 ? names[0]! : `${names.length} spawns`;
  const ready = picked !== 'mixed' && !pending;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialog}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Game events"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
          trapTab(e, dialog.current);
        }}
      >
        <header className="modal__header">
          <h2>Game events</h2>
        </header>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (picked !== 'mixed' && ready) onApply(picked);
          }}
        >
          <p>Which game events these spawns follow:</p>
          <p>
            <strong>{who}</strong>
          </p>
          <EventRuleField id="spawn-events" events={events} value={picked} inherit="Same as the NPC" onPending={setPending}
            onChange={(next) => setPicked(next as SpawnEvents)} />
          <div className="world3d__dialog-actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={!ready}>
              Apply
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

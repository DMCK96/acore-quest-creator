import { useRef, useState } from 'react';
import { trapTab } from '../components/trap-tab';
import '../views/ProjectDialog.css';

/** A field's whole number, 0 when it is blank; null when it holds anything else */
const wholeOf = (text: string): number | null => (text === '' ? 0 : /^\d+$/.test(text) ? Number(text) : null);

/**
 * Changes how long spawns take to respawn, in minutes and seconds. It starts from their time when
 * they share one, and blank when they differ; Apply keeps the time typed (a blank field is 0).
 */
export function RespawnDialog({
  names,
  initial,
  onApply,
  onClose,
}: {
  names: string[];
  initial: number | null;
  onApply(secs: number): void;
  onClose(): void;
}): React.JSX.Element {
  const dialog = useRef<HTMLDivElement>(null);
  const [minutes, setMinutes] = useState(initial === null ? '' : String(Math.floor(initial / 60)));
  const [seconds, setSeconds] = useState(initial === null ? '' : String(initial % 60));
  const m = wholeOf(minutes);
  const s = wholeOf(seconds);
  const secs = (minutes !== '' || seconds !== '') && m !== null && s !== null ? m * 60 + s : null;
  const who = names.length === 1 ? names[0]! : `${names.length} spawns`;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialog}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Respawn time"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
          trapTab(e, dialog.current);
        }}
      >
        <header className="modal__header">
          <h2>Respawn time</h2>
        </header>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (secs !== null) onApply(secs);
          }}
        >
          <p>How long after it is killed or used up each of these comes back:</p>
          <p>
            <strong>{who}</strong>
          </p>
          <label className="scene-field">
            <span>Minutes</span>
            <input
              type="number"
              min={0}
              step={1}
              autoFocus
              // Esc closes this dialog, not the 3D view round it
              data-selection="on"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
            />
          </label>
          <label className="scene-field">
            <span>Seconds</span>
            <input type="number" min={0} step={1} data-selection="on" value={seconds} onChange={(e) => setSeconds(e.target.value)} />
          </label>
          <div className="world3d__dialog-actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={secs === null}>
              Apply
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

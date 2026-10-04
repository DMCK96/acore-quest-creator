import { useRef, useState } from 'react';
import { trapTab } from '../components/trap-tab';
import '../views/ProjectDialog.css';

/** A wander distance the server takes: whole yards, none to a hundred */
const MAX_YARDS = 100;
const yardsOf = (text: string): number | null => (/^\d+$/.test(text) && Number(text) <= MAX_YARDS ? Number(text) : null);

/**
 * Changes how far an NPC roams from where it stands. Its wander circle follows each value typed, and
 * Apply keeps it; 0 makes it stand still.
 */
export function WanderDialog({
  name,
  initial,
  onPreview,
  onApply,
  onClose,
}: {
  name: string;
  initial: number;
  onPreview(yards: number): void;
  onApply(yards: number): void;
  onClose(): void;
}): React.JSX.Element {
  const dialog = useRef<HTMLDivElement>(null);
  const [text, setText] = useState(String(initial));
  const yards = yardsOf(text);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialog}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Wander distance"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
          trapTab(e, dialog.current);
        }}
      >
        <header className="modal__header">
          <h2>Wander distance</h2>
        </header>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (yards !== null) onApply(yards);
          }}
        >
          <p>How far {name || 'this NPC'} roams from where it stands. 0 makes it stand still.</p>
          <label className="scene-field">
            <span>Yards</span>
            <input
              type="number"
              min={0}
              max={MAX_YARDS}
              step={1}
              autoFocus
              // Esc closes this dialog, not the 3D view round it
              data-selection="on"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                const next = yardsOf(e.target.value);
                if (next !== null) onPreview(next);
              }}
            />
          </label>
          <div className="world3d__dialog-actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={yards === null}>
              Apply
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import type { StepPlace } from '@shared/ipc';
import type { AppStore } from '../state/app-store';
import './HistoryButtons.css';

/** How long the note stays once it stops changing, unless the pointer is on it */
const NOTE_MS = 6000;

type WorldPlace = Extract<StepPlace, { map: number }>;

/** Says what the last undo or redo did and what it could not, with Show to go to it */
export function HistoryNote({
  store,
  onShowQuest,
  onShowPlace,
}: {
  store: AppStore;
  onShowQuest(questId: number): void;
  onShowPlace(place: WorldPlace): void;
}): React.JSX.Element | null {
  const note = store((s) => s.historyNote);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    if (!note || hovered) return;
    const timer = setTimeout(() => store.getState().dismissHistoryNote(), NOTE_MS);
    return () => clearTimeout(timer);
  }, [note, hovered, store]);

  if (!note) return null;
  const where = note.where;
  const show = (): void => {
    if (!where) return;
    if ('questId' in where) onShowQuest(where.questId);
    else onShowPlace(where);
    store.getState().dismissHistoryNote();
  };
  return (
    <div className="history-note glass" role="status" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <div className="history-note__text">
        {note.text}
        {note.skipped.length > 0 && (
          <ul className="history-note__skipped">
            {note.skipped.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </div>
      {where && (
        <button type="button" className="btn" onClick={show}>
          Show
        </button>
      )}
      <button type="button" className="btn btn--icon" aria-label="Close" title="Close" onClick={() => store.getState().dismissHistoryNote()}>
        ×
      </button>
    </div>
  );
}

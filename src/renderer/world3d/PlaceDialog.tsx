import { useId, useRef, useState } from 'react';
import { useEntityHits } from './useEntityHits';
import { trapTab } from '../components/trap-tab';
import type { PlaceTarget } from './placing';
import '../views/ProjectDialog.css';

export type Chosen = PlaceTarget & { name: string };

/**
 * Chooses an existing NPC or object to place in the world: search the database by name or ID, pick a
 * result, then click the ground in the view for each one to put down.
 */
export function PlaceDialog({
  kind: startKind = 'creature',
  once = false,
  onPick,
  onClose,
}: {
  /** What the dialog starts on */
  kind?: PlaceTarget['kind'];
  /** Picking one places it once, where the view was right-clicked, instead of clicking the ground for each */
  once?: boolean;
  onPick(chosen: Chosen): void;
  onClose(): void;
}): React.JSX.Element {
  const dialog = useRef<HTMLDivElement>(null);
  const name = useId();
  const [kind, setKind] = useState<PlaceTarget['kind']>(startKind);
  const [text, setText] = useState('');
  const { hits, error, searched } = useEntityHits(kind === 'creature' ? 'creature' : 'gameobject', text);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialog}
        className="modal place-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Place an NPC or object"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          trapTab(e, dialog.current);
        }}
      >
        <header className="modal__header">
          <h2>Place an NPC or object</h2>
          <button type="button" className="btn btn--icon" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="place-dialog__kinds" role="radiogroup" aria-label="What to place">
          {(['creature', 'object'] as const).map((k) => (
            <label key={k}>
              <input type="radio" name={name} checked={kind === k} onChange={() => setKind(k)} />
              {k === 'creature' ? 'NPC' : 'Object'}
            </label>
          ))}
        </div>
        <input
          type="search"
          className="place-dialog__search"
          aria-label="Find by name or ID"
          placeholder="Type a name or ID"
          autoFocus
          // Esc closes this dialog, not the 3D view round it
          data-selection="on"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <ul className="place-dialog__list" aria-label="Matches">
          {hits.map((hit) => (
            <li key={hit.id}>
              <button type="button" className="place-dialog__hit" onClick={() => onPick({ kind, entry: hit.id, name: hit.name })}>
                {hit.name || `${kind === 'creature' ? 'NPC' : 'Object'} ${hit.id}`}
                <span className="place-dialog__detail">
                  {hit.detail ? `${hit.detail} · ` : ''}#{hit.id}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {searched && !error && hits.length === 0 && <p className="place-dialog__note">Nothing in the database matches.</p>}
        {error && <p className="place-dialog__note">{error}</p>}
        <p className="place-dialog__note">
          {once ? 'Pick one to place it where you right-clicked.' : 'Pick one, then click the ground in the view to place it. Each click places another; Esc stops.'}
        </p>
      </div>
    </div>
  );
}

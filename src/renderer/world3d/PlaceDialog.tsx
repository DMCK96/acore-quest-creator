import { useEffect, useId, useRef, useState } from 'react';
import type { EntityHit } from '@core/db/world-db';
import { useEntitySearch } from '../state/names';
import { trapTab } from '../components/trap-tab';
import type { PlaceTarget } from './placing';
import '../views/ProjectDialog.css';

const SEARCH_DELAY_MS = 150;

export type Chosen = PlaceTarget & { name: string };

/**
 * Chooses an existing NPC or object to place in the world: search the database by name or ID, pick a
 * result, then click the ground in the view for each one to put down.
 */
export function PlaceDialog({ onPick, onClose }: { onPick(chosen: Chosen): void; onClose(): void }): React.JSX.Element {
  const dialog = useRef<HTMLDivElement>(null);
  const search = useEntitySearch();
  const name = useId();
  const [kind, setKind] = useState<PlaceTarget['kind']>('creature');
  const [text, setText] = useState('');
  const [hits, setHits] = useState<EntityHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const token = useRef(0);

  // Each keystroke or change of kind asks again; a slower answer to an older ask never replaces a newer one
  useEffect(() => {
    const needle = text.trim();
    const mine = ++token.current;
    setError(null);
    if (needle === '') {
      setHits([]);
      setSearched(false);
      return;
    }
    const timer = setTimeout(() => {
      void search(kind === 'creature' ? 'creature' : 'gameobject', needle).then((result) => {
        if (mine !== token.current) return;
        setSearched(true);
        if (result.ok) setHits(result.value);
        else {
          setHits([]);
          setError(result.error.message);
        }
      });
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [kind, text, search]);

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
        <p className="place-dialog__note">Pick one, then click the ground in the view to place it. Each click places another; Esc stops.</p>
      </div>
    </div>
  );
}

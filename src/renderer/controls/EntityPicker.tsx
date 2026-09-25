import { useEffect, useId, useRef, useState } from 'react';
import type { EntityHit, SearchKind } from '@core/db/world-db';
import { useEntitySearch, useName } from '../state/names';
import './EntityPicker.css';

export interface EntityPickerProps {
  id: string;
  label: string;
  kind: SearchKind;
  value: number;
  onChange(id: number): void;
  disabled?: boolean;
  readOnlyReason?: string;
}

const SEARCH_DELAY_MS = 150;

/** A negative ID is a quest log category, which players and designers know by name only. */
const idLabel = (id: number): string => (id < 0 ? '' : ` · #${id}`);

const optionLabel = (hit: EntityHit): string =>
  hit.detail ? `${hit.name} · ${hit.detail}${idLabel(hit.id)}` : `${hit.name}${idLabel(hit.id)}`;

/**
 * Picks an item, NPC, object or quest by typing part of its name (or its ID) and choosing a
 * result. Shows the current choice by name; an ID the database no longer has is kept and flagged,
 * never silently cleared.
 */
export function EntityPicker({ id, label, kind, value, onChange, disabled, readOnlyReason }: EntityPickerProps): React.JSX.Element {
  const search = useEntitySearch();
  const { state, name } = useName(kind, value);
  const listId = useId();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [hits, setHits] = useState<EntityHit[]>([]);
  const [active, setActive] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const token = useRef(0);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // Closing also forgets the search in flight, so its answer cannot reappear in a later search.
  function close(): void {
    if (timer.current) clearTimeout(timer.current);
    token.current++;
    setEditing(false);
    setHits([]);
    setActive(-1);
  }

  // Results for one kind are never offered for another (an NPC ID stored as an object's).
  useEffect(() => {
    close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  function type(next: string): void {
    setEditing(true);
    setText(next);
    setError(null);
    if (timer.current) clearTimeout(timer.current);
    const needle = next.trim();
    if (needle === '') {
      setHits([]);
      return;
    }
    timer.current = setTimeout(() => {
      const mine = ++token.current;
      void search(kind, needle).then((result) => {
        // A slower answer to an older keystroke must not replace a newer one.
        if (mine !== token.current) return;
        if (result.ok) {
          setHits(result.value);
          setActive(-1);
        } else {
          setHits([]);
          setError(result.error.message);
        }
      });
    }, SEARCH_DELAY_MS);
  }

  function pick(hit: EntityHit): void {
    onChange(hit.id);
    close();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'ArrowDown' && hits.length > 0) {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, hits.length - 1));
    } else if (e.key === 'ArrowUp' && hits.length > 0) {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && active >= 0 && hits[active]) {
      e.preventDefault();
      pick(hits[active]);
    } else if (e.key === 'Escape' && hits.length > 0) {
      e.stopPropagation();
      close();
    }
  }

  const shown = editing ? text : state === 'found' ? (name ?? '') : '';
  const open = editing && hits.length > 0;

  return (
    <div className="control entity-picker">
      <label htmlFor={id} className="control__label">{label}</label>
      <div className="entity-picker__row">
        <input
          id={id}
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          placeholder="Type a name or ID"
          value={shown}
          disabled={disabled}
          onChange={(e) => type(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={close}
        />
        {(value > 0 || (value < 0 && state === 'missing')) && (
          <span className={state === 'missing' ? 'entity-picker__id entity-picker__id--missing' : 'entity-picker__id'}>
            {state === 'missing' ? `#${value} not found in your database` : `#${value}`}
          </span>
        )}
        {value !== 0 && !disabled && (
          <button type="button" className="entity-picker__clear" aria-label={`Clear ${label}`} onClick={() => onChange(0)}>
            ×
          </button>
        )}
      </div>
      <ul id={listId} role="listbox" className="entity-picker__list" hidden={!open}>
        {open &&
          hits.map((hit, i) => (
            <li
              key={hit.id}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'entity-picker__option entity-picker__option--active' : 'entity-picker__option'}
              // Keep focus in the input so its blur does not close the list before the click lands.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(hit)}
            >
              {optionLabel(hit)}
            </li>
          ))}
      </ul>
      {error && <p role="alert" className="control__alert">{error}</p>}
      {readOnlyReason && <p role="alert" className="control__alert">{readOnlyReason}</p>}
    </div>
  );
}

import { useState } from 'react';
import './EventPicker.css';

/** A game event the database has, named by its description */
export type GameEvent = { id: number; name: string };

const nameOf = (ev: GameEvent): string => ev.name || `Event ${ev.id}`;

/**
 * Picks game events by searching their names: one (a spawn group follows one event) or several (an
 * NPC's spawns can follow any of several). With several, the chosen ones show as chips that take
 * themselves off; with one, the search shows the chosen name.
 */
export function EventPicker({
  id,
  events,
  chosen,
  multiple = false,
  onChange,
}: {
  id: string;
  events: readonly GameEvent[];
  chosen: readonly number[];
  multiple?: boolean;
  onChange(ids: number[]): void;
}): React.JSX.Element {
  const [query, setQuery] = useState<string | null>(null);
  if (events.length === 0) return <p role="alert">No events in the database</p>;
  const needle = (query ?? '').trim().toLowerCase();
  const matching = events.filter((ev) => !needle || nameOf(ev).toLowerCase().includes(needle) || String(ev.id).includes(needle));
  const named = (eventId: number): string => {
    const ev = events.find((e) => e.id === eventId);
    return ev ? nameOf(ev) : `Event ${eventId}`;
  };
  const shown = query ?? (multiple || chosen[0] === undefined ? '' : named(chosen[0]));
  const pick = (eventId: number): void => {
    setQuery(null);
    if (!multiple) onChange([eventId]);
    else if (!chosen.includes(eventId)) onChange([...chosen, eventId]);
  };

  return (
    <div className="scene-field">
      {multiple && chosen.length > 0 && (
        <div className="scene-row" aria-label="Chosen events">
          {chosen.map((eventId) => (
            <button key={eventId} type="button" className="entry-card__btn" aria-label={`Remove ${named(eventId)}`} onClick={() => onChange(chosen.filter((c) => c !== eventId))}>
              {named(eventId)} ×
            </button>
          ))}
        </div>
      )}
      <label>
        <span>{multiple ? 'Which events' : 'Which event'}</span>
        <input
          type="text"
          role="combobox"
          aria-label={multiple ? 'Which events' : 'Which event'}
          aria-expanded="true"
          aria-controls={`${id}-list`}
          data-selection="on"
          autoComplete="off"
          placeholder="Search events"
          value={shown}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {chosen.length === 0 && <p role="alert">{multiple ? 'Choose at least one event' : 'Choose an event'}</p>}
      <ul id={`${id}-list`} role="listbox" aria-label="Events" aria-multiselectable={multiple || undefined} className="event-picker__list">
        {matching.map((ev) => (
          <li key={ev.id} role="option" aria-selected={chosen.includes(ev.id)} onClick={() => pick(ev.id)}>
            {nameOf(ev)}
          </li>
        ))}
        {matching.length === 0 && <li aria-disabled="true">No event matches</li>}
      </ul>
    </div>
  );
}

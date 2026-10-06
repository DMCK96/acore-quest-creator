import { useEffect, useState } from 'react';
import { makeRule } from '@core/entities/spawn-events';
import type { EventRule } from '@core/entities/model';
import { EventPicker, type GameEvent } from '../controls/EventPicker';

type Value = EventRule | 'npc' | 'asIs';
type Choice = 'npc' | 'asIs' | 'always' | 'during' | 'except' | 'mixed';

const choiceOf = (value: Value | 'mixed'): Choice => (value === 'npc' || value === 'asIs' || value === 'mixed' ? value : value === null ? 'always' : value.mode);
const eventsOf = (value: Value | 'mixed'): number[] => (value && typeof value === 'object' ? value.events : []);

/**
 * Which game events spawns follow: always in the world, only during any of some events, or gone
 * during any of them, with the NPC's rule (`inherit` names that choice) or, for an existing NPC whose
 * spawns differ, each spawn's own (`asIs`). A choice of events is saved only once it names one: until
 * then it stays here and the value is left as it was.
 */
export function EventRuleField({
  id,
  events,
  value,
  inherit,
  asIs = false,
  onChange,
  onPending,
}: {
  id: string;
  events: readonly GameEvent[];
  /** 'mixed': spawns that differ, shown as nothing chosen yet */
  value: Value | 'mixed';
  /** The label of following the NPC's rule; not offered without one */
  inherit?: string;
  asIs?: boolean;
  onChange(next: Value): void;
  /** Told whether a choice of events is waiting for its first event */
  onPending?(pending: boolean): void;
}): React.JSX.Element {
  // A direction chosen with no event yet: shown, but not saved
  const [pending, setPending] = useState<'during' | 'except' | null>(null);
  const key = JSON.stringify(value);
  // A value changed from outside (an undo) takes back an unfinished choice
  useEffect(() => setPending(null), [key]);
  useEffect(() => onPending?.(pending !== null), [pending, onPending]);
  const choice = pending ?? choiceOf(value);
  const chosen = pending ? [] : eventsOf(value);

  const choose = (next: Choice): void => {
    if (next === 'npc' || next === 'asIs') return (setPending(null), onChange(next));
    if (next === 'always') return (setPending(null), onChange(null));
    if (next === 'mixed') return;
    const kept = makeRule(next, eventsOf(value));
    if (kept) {
      setPending(null);
      onChange(kept);
    } else setPending(next);
  };

  return (
    <>
      <label className="scene-field">
        <span>Event</span>
        <select aria-label="Event" data-selection="on" value={choice} onChange={(e) => choose(e.target.value as Choice)}>
          {choice === 'mixed' && <option value="mixed" disabled>Choose…</option>}
          {inherit && <option value="npc">{inherit}</option>}
          {asIs && <option value="asIs">As each spawn has it</option>}
          <option value="always">Always</option>
          <option value="during">Only during…</option>
          <option value="except">Gone during…</option>
        </select>
      </label>
      {(choice === 'during' || choice === 'except') && (
        <EventPicker
          id={id}
          events={events}
          chosen={chosen}
          multiple
          onChange={(ids) => {
            const rule = makeRule(choice, ids);
            if (!rule) return setPending(choice);
            setPending(null);
            onChange(rule);
          }}
        />
      )}
    </>
  );
}

import { useEffect, useState } from 'react';
import type { GameEvent } from '../controls/EventPicker';
import { useApi } from './names';

/** The game events the world database has, by name; none until they are read, or without a database */
export function useGameEvents(): readonly GameEvent[] {
  const api = useApi();
  const [events, setEvents] = useState<readonly GameEvent[]>([]);
  useEffect(() => {
    let live = true;
    void Promise.resolve(api?.gameEvents?.()).then((r) => {
      if (live && r?.ok) setEvents(r.value);
    });
    return () => {
      live = false;
    };
  }, [api]);
  return events;
}

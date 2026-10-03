import { useEffect, useRef, useState } from 'react';
import type { EntityHit } from '@core/db/world-db';
import { useEntitySearch } from '../state/names';

const SEARCH_DELAY_MS = 150;

/**
 * The database's NPCs or objects whose name or id matches the text, as it is typed: asked a moment
 * after the last keystroke, and a slower answer to an older ask never replaces a newer one.
 */
export function useEntityHits(kind: 'creature' | 'gameobject', text: string): { hits: EntityHit[]; error: string | null; searched: boolean } {
  const search = useEntitySearch();
  const [hits, setHits] = useState<EntityHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const token = useRef(0);

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
      void search(kind, needle).then((result) => {
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

  return { hits, error, searched };
}

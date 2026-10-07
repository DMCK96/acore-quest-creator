import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { Api } from '@shared/ipc';
import { onWorldMapsChange, setClientMaps, worldMaps, type WorldMap } from '@core/map/world-maps';

/**
 * Reads the maps the game client holds beyond the continents (dungeons, raids, battlegrounds ...) once a
 * client is set, so the World can draw them. Returns every map drawn, and a promise that settles when the
 * read has finished (an answer that needs a map waits for it).
 */
export function useClientMaps(api: Api | null | undefined, hasClient: boolean): { maps: readonly WorldMap[]; ready: () => Promise<void> } {
  const maps = useSyncExternalStore(onWorldMapsChange, worldMaps);
  const pending = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    if (!api || !hasClient) {
      setClientMaps([]);
      return;
    }
    let live = true;
    pending.current = api
      .clientMaps()
      .then((answer) => {
        if (live && answer.ok) setClientMaps(answer.value);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [api, hasClient]);
  return { maps, ready: () => pending.current };
}

import { useEffect, useState } from 'react';
import { useApi } from '../state/names';
import { useProjectEntities } from '../state/project-entities';

/**
 * Whether an NPC or object has a spawn in the world: false only once known to have none. The project's own
 * spawns count; otherwise the world database is asked when the panel shows. Unknown (still reading, no
 * connection, or a failed read) stays true, so Go to is never disabled on a guess.
 */
export function useHasSpawn(kind: 'creature' | 'gameobject', entry: number): boolean {
  const api = useApi();
  const entities = useProjectEntities()?.entities;
  const own = (kind === 'creature' ? entities?.npcs : entities?.objects)?.find((e) => e.entry === entry);
  const ownSpawns = own ? own.spawns.length : 0;
  const [none, setNone] = useState<string | null>(null);
  const key = `${kind}:${entry}`;
  useEffect(() => {
    if (!api || entry <= 0 || ownSpawns > 0) return;
    let live = true;
    void api.entitySpawns(kind, entry).then((read) => {
      if (live && read.ok && read.value.length === 0) setNone(key);
    }).catch(() => undefined);
    return () => { live = false; };
  }, [api, kind, entry, key, ownSpawns]);
  return ownSpawns > 0 || none !== key;
}

import { useEffect, useState } from 'react';
import { useApi } from '../../state/names';
import { useProjectEntities } from '../../state/project-entities';

/** A part as the open quest's card keys it: its kind and entry */
export const partKey = (kind: 'creature' | 'gameobject', entry: number): string => `${kind}:${entry}`;

/**
 * The open quest's NPCs and objects that already stand somewhere in the world, by `partKey`: the one
 * spawn list the World reads for the quest (its database spawns, the project's own and the ones placed
 * in the World). Read again when the project's NPCs or the world layer change, as a placing does, and
 * on each new `saved` (the graph read again after a quest edit reached the project, which can name
 * another NPC). Empty while reading, without a quest, or when it could not be read, so nothing is marked
 * on a guess.
 */
export function usePlacedParts(questId: number | null, saved: unknown): ReadonlySet<string> {
  const api = useApi();
  const project = useProjectEntities();
  const entities = project?.entities;
  const layer = project?.layer;
  const [placed, setPlaced] = useState<{ questId: number; keys: ReadonlySet<string> } | null>(null);
  useEffect(() => {
    if (!api || questId === null) return;
    let live = true;
    void api.questSpawnList([questId]).then((read) => {
      if (!live || !read.ok) return;
      const keys = new Set(read.value.flatMap((group) => group.spawns.map((s) => partKey(s.kind, s.entry))));
      setPlaced({ questId, keys });
    }).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [api, questId, entities, layer, saved]);
  return placed && placed.questId === questId ? placed.keys : NONE;
}

const NONE: ReadonlySet<string> = new Set();

import type { Api } from '@shared/ipc';

/** Said when every spawn guid in the project's range is taken */
export const NO_FREE_GUID = 'No free spawn ID could be found.';

/** A fresh guid for a new spawn of the project's own NPC or object, or why there is none */
export async function newSpawnGuid(api: Api, kind: 'creature' | 'object'): Promise<{ guid: number } | { error: string }> {
  const ids = await api.allocateIds(kind === 'object' ? 'gameobjectSpawn' : 'creatureSpawn', 1);
  if (!ids.ok) return { error: ids.error.message };
  return ids.value.length > 0 ? { guid: ids.value[0]! } : { error: NO_FREE_GUID };
}

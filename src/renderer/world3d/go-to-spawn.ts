import type { SpawnLocation } from '@core/entities/entity';
import type { Api } from '@shared/ipc';
import type { FocusTarget } from './World3DView';

/** Where Project changes' Go to takes the view: a spawn on its map */
export type GoToTarget = Omit<FocusTarget, 'nonce'> & { map: number };

/**
 * The view's target for a tracked spawn. A spawn changed without being moved (movement, path, respawn,
 * group) has no place yet: where it stands is read first. The message to show when it cannot be.
 */
export async function goToTarget(
  api: Pick<Api, 'spawnPlacement'>,
  spawn: SpawnLocation,
  entity: { entry: number; name: string } | undefined,
): Promise<GoToTarget | { error: string }> {
  let at = spawn.x !== undefined && spawn.y !== undefined && spawn.z !== undefined ? { x: spawn.x, y: spawn.y, z: spawn.z } : null;
  if (!at) {
    const read = await api.spawnPlacement(spawn.kind === 'creature' ? 'npc' : 'object', spawn.guid);
    if (!read.ok) return { error: read.error.message };
    if (!read.value) return { error: `Spawn ${spawn.guid} is not in the database any more.` };
    at = read.value;
  }
  return { kind: spawn.kind, guid: spawn.guid, entry: entity?.entry ?? 0, name: entity?.name ?? '', map: spawn.map, ...at, event: null, added: false };
}

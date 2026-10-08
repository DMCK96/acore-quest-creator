import * as THREE from 'three';
import type { Dock } from '../../../../core/map/transport-docks.js';
import { describeError } from '../diagnostics.js';
import { WHOLE_MAP } from '../map/global-wmo.js';
import type { DockInstance, DockState } from './DockSet.js';
import type SpawnManager from './SpawnManager.js';

/** The area a dock's passengers are loaded as: all of the transport map's rows at once, tied to no tile */
export const DOCK_AREA = -1;

const warn = (what: string) => (error: unknown) => console.warn(`3D view: ${what} could not be drawn: ${describeError(error)}`);

/**
 * A dock drawn by its own spawn manager (made with the dock's frame): the vessel at the frame, and the
 * transport map's rows as its passengers. Everything is under one `root`.
 */
export function createSpawnDock(dock: Dock, manager: SpawnManager): DockInstance {
  const root = new THREE.Group();
  root.name = `dock:${dock.key}`;
  root.add(manager.decor);
  manager.setVessel({ displayId: dock.displayId }).catch(warn(`the vessel at dock ${dock.key}`));
  let disposed = false;
  let sourced = false;
  let area: THREE.Group | null = null;

  const load = (): void => {
    if (disposed || !manager.canLoad(DOCK_AREA)) return;
    manager
      .loadArea(DOCK_AREA, dock.map, WHOLE_MAP, (group) => {
        // Shown while it fills; not if the dock went meanwhile
        if (disposed) return;
        area = group;
        root.add(group);
      })
      .then(() => {
        if (disposed) manager.removeArea(DOCK_AREA);
      })
      .catch(warn(`the passengers at dock ${dock.key}`));
  };

  return {
    root,
    decor: manager.decor,
    configure(patch: Partial<DockState>) {
      if (disposed) return;
      if ('source' in patch) {
        manager.setSource(patch.source ?? null);
        sourced = Boolean(patch.source);
      }
      if (patch.looks) manager.setLooks(patch.looks).catch(warn('edited looks'));
      if (patch.own) manager.setOwnSpawns(patch.own).catch(warn('the quest’s own NPCs and objects'));
      if (patch.visibility) manager.setVisibility(patch.visibility).catch(warn('the NPCs and objects'));
      if (patch.layer) manager.setWorldLayer(patch.layer).catch(warn('the world changes'));
      if (patch.groups) manager.setGroupSpawns(patch.groups).catch(warn('the spawn groups’ events'));
      if ('source' in patch) load();
    },
    pick: (ray, maxDistance) => manager.pickHit(ray, maxDistance),
    find: (kind, guid) => manager.find(kind, guid),
    picked: (kind, guid) => manager.picked(kind, guid),
    info: (kind, guid) => manager.info(kind, guid),
    cull: (camera, frustum) => manager.cull(camera, frustum),
    // `load` asks only when the area is not drawn, not on its way and not recently failed
    update: (deltaTime, camera) => {
      if (sourced) load();
      manager.update(deltaTime, camera);
    },
    candidates: (camera) => manager.candidates(camera).spawns,
    get status() {
      return manager.status;
    },
    dispose() {
      disposed = true;
      manager.removeArea(DOCK_AREA);
      area?.removeFromParent();
      area = null;
      manager.setVessel(null).catch(warn(`the vessel at dock ${dock.key}`));
      root.removeFromParent();
      root.clear();
    },
  };
}

import type { SpawnDot, MapBox } from '../db/spawns';
import type { ViewCreature, ViewObject, ViewSpawns } from '../db/view-spawns';
import { ownViewSpawns } from '../entities/view-spawns';
import type { ProjectEntities } from '../entities/model';
import { isDeleted, type WorldLayer, type WorldSpawnKind } from './layer';

/** What the project changed about a spawn: marked, with where the database has it when it was moved */
export type Changed = { source?: 'project'; movedFrom?: { map: number; x: number; y: number; z: number } };

type Edit = WorldLayer['spawns'][number];

const inBox = (s: { map: number; x: number; y: number }, map: number, box: MapBox): boolean => s.map === map && s.x >= box.minX && s.x <= box.maxX && s.y >= box.minY && s.y <= box.maxY;

/**
 * Every spawn of one NPC or object as the project has it: the database's minus those deleted, as moved
 * in the world layer, plus those placed in the 3D view and those of the project's own new NPCs and objects.
 */
export function overlayFound(dots: readonly SpawnDot[], layer: WorldLayer, entities: ProjectEntities, kind: WorldSpawnKind, entry: number): (SpawnDot & Changed)[] {
  const moved = new Map(layer.spawns.filter((s) => s.kind === kind).map((s) => [s.guid, s]));
  const fromDatabase = dots
    .filter((d) => !isDeleted(layer, kind, d.guid))
    .map((d): SpawnDot & Changed => {
      const edit = moved.get(d.guid);
      return edit ? { ...d, x: edit.current.x, y: edit.current.y, z: edit.current.z, source: 'project', movedFrom: { map: d.map, x: d.x, y: d.y, z: d.z } } : d;
    });
  const placed = layer.added
    .filter((a) => a.kind === kind && a.entry === entry)
    .map((a): SpawnDot & Changed => ({ kind, guid: a.guid, entry, name: a.name, map: a.map, x: a.placement.x, y: a.placement.y, z: a.placement.z, source: 'project' }));
  const owners = kind === 'creature' ? entities.npcs : entities.objects;
  const own = owners
    .filter((e) => e.entry === entry)
    .flatMap((e) => e.spawns.map((s): SpawnDot & Changed => ({ kind, guid: s.guid, entry, name: e.name, map: s.map, x: s.x, y: s.y, z: s.z, source: 'project' })));
  return [...fromDatabase, ...placed, ...own];
}

const placedCreature = (a: WorldLayer['added'][number]): ViewCreature => ({
  guid: a.guid, entry: a.entry, name: a.name, map: a.map, x: a.placement.x, y: a.placement.y, z: a.placement.z, orientation: a.placement.orientation,
  displayId: a.look.displayId, scale: a.look.scale, wander: 0, path: null, pathId: 0, equipment: a.look.equipment, own: false, added: true, event: null, events: [], removedBy: [], preset: a.look.preset, group: null,
  respawnSecs: a.respawnSecs ?? 300, ...(a.events !== undefined ? { spawnEvents: a.events } : {}),
});
const placedObject = (a: WorldLayer['added'][number]): ViewObject => ({
  guid: a.guid, entry: a.entry, name: a.name, map: a.map, x: a.placement.x, y: a.placement.y, z: a.placement.z,
  rotation: a.placement.rotation ?? [0, 0, Math.sin(a.placement.orientation / 2), Math.cos(a.placement.orientation / 2)],
  displayId: a.look.displayId, scale: a.look.scale, objectType: a.look.objectType ?? -1, own: false, added: true, event: null, events: [], removedBy: [], group: null,
  respawnSecs: a.respawnSecs ?? 300,
});
/** A moved spawn that the database did not give for the area has no look of its own: it is given as a marker */
const markerCreature = (edit: Edit): ViewCreature => ({
  guid: edit.guid, entry: edit.entry, name: edit.name, map: edit.map, x: edit.current.x, y: edit.current.y, z: edit.current.z, orientation: edit.current.orientation,
  displayId: 0, scale: 1, wander: 0, path: null, pathId: 0, equipment: [0, 0, 0], own: false, event: null, events: [], removedBy: [], preset: null, group: null, respawnSecs: 300,
});
const markerObject = (edit: Edit): ViewObject => ({
  guid: edit.guid, entry: edit.entry, name: edit.name, map: edit.map, x: edit.current.x, y: edit.current.y, z: edit.current.z,
  rotation: edit.current.rotation ?? [0, 0, Math.sin(edit.current.orientation / 2), Math.cos(edit.current.orientation / 2)],
  displayId: 0, scale: 1, objectType: -1, own: false, event: null, events: [], removedBy: [], group: null, respawnSecs: 300,
});

/**
 * An area's spawns as the project has them: those the database gave minus those deleted, as moved (a
 * spawn moved out of the box leaves it, one moved in comes in), plus those placed and the project's own.
 */
export function overlayView(
  view: ViewSpawns,
  layer: WorldLayer,
  entities: ProjectEntities,
  map: number,
  box: MapBox,
): { creatures: (ViewCreature & Changed)[]; objects: (ViewObject & Changed)[]; capped: ViewSpawns['capped'] } {
  const apply = <T extends ViewCreature | ViewObject>(rows: readonly T[], kind: WorldSpawnKind, made: (edit: Edit) => T, extra: readonly T[]): (T & Changed)[] => {
    const edits = new Map(layer.spawns.filter((s) => s.kind === kind).map((s) => [s.guid, s]));
    const seen = new Set<number>();
    const out: (T & Changed)[] = [];
    for (const row of rows) {
      seen.add(row.guid);
      if (isDeleted(layer, kind, row.guid)) continue;
      const edit = edits.get(row.guid);
      if (!edit) {
        out.push(row);
        continue;
      }
      const at = edit.current;
      const turned = kind === 'creature' ? { orientation: at.orientation } : at.rotation ? { rotation: at.rotation } : {};
      out.push({ ...row, x: at.x, y: at.y, z: at.z, ...turned, source: 'project', movedFrom: { map: row.map, x: row.x, y: row.y, z: row.z } } as T & Changed);
    }
    // Moved into the box from outside it: the database did not give it
    for (const edit of edits.values()) {
      if (seen.has(edit.guid) || isDeleted(layer, kind, edit.guid)) continue;
      out.push({ ...made(edit), source: 'project', movedFrom: { map: edit.map, x: edit.original.x, y: edit.original.y, z: edit.original.z } });
    }
    for (const row of extra) out.push({ ...row, source: 'project' });
    return out.filter((row) => inBox(row, map, box));
  };
  const mine = ownViewSpawns(entities);
  return {
    creatures: apply(view.creatures, 'creature', markerCreature, [...layer.added.filter((a) => a.kind === 'creature').map(placedCreature), ...mine.creatures]),
    objects: apply(view.objects, 'gameobject', markerObject, [...layer.added.filter((a) => a.kind === 'gameobject').map(placedObject), ...mine.objects]),
    capped: view.capped,
  };
}

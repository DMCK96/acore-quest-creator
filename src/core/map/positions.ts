import { newSpawn, type ProjectEntities, type SpawnEvents } from '../entities/model';
import type { FieldValue } from '../registry/types';
import { newPatrol } from './patrol';
import type { Movement } from '../world/movement';
import { readScenes, splitScenes, SCRIPTS_FIELD, writeScenes, type Position, type QuestScene, type SceneStep } from '../scripts/model';

/**
 * The positions a quest uses that the World draws as markers (scene steps, escort and fight points,
 * areas, POI outlines), the edit that moves one, and the edits to the project's own spawns. A marker's
 * id names where its position lives, so a move changes exactly that one value: a field of the quest
 * (its scenes), or the project's NPCs.
 */

export type MarkerKind = 'scenePoint' | 'escortPoint' | 'fightPoint' | 'area' | 'poi';

export interface QuestMarker {
  id: string;
  kind: MarkerKind;
  label: string;
  /** The map it is on; null when nothing says which. */
  map: number | null;
  x: number;
  y: number;
  z: number;
  draggable: boolean;
  radius?: number;
  outline?: { x: number; y: number }[];
  note?: string;
}

type Values = Readonly<Record<string, unknown>>;
/** A change to the project's NPCs, objects and items; null when there was nothing to change */
type EntitiesEdit = ProjectEntities | null;
/** What moving a marker changes: a field of the quest, or the project's NPCs and objects */
export type MarkerEdit = { field: string; value: FieldValue } | { entities: ProjectEntities } | null;

const NO_MAP_NOTE = 'Its NPC has no spawn yet, so its map is not known.';

const sceneName = (scene: QuestScene): string => scene.name.trim() || `Scene ${scene.id}`;
const npcName = (name: string, entry: number): string => name.trim() || `New NPC ${entry}`;

/** The map of the quest's own NPCs and objects, from their first spawn, overriding what the database says. */
function ownerMaps(entities: ProjectEntities, knownMaps: ReadonlyMap<string, number>): Map<string, number> {
  const maps = new Map(knownMaps);
  for (const npc of entities.npcs) if (npc.spawns[0]) maps.set(`creature:${npc.entry}`, npc.spawns[0].map);
  for (const object of entities.objects) if (object.spawns[0]) maps.set(`gameobject:${object.entry}`, object.spawns[0].map);
  return maps;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const rowsOf = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);

/** The markers of a quest: from its own values and the project's NPCs and objects it uses (`entities`) */
export function questMarkers(values: Values, entities: ProjectEntities, knownMaps: ReadonlyMap<string, number> = new Map()): QuestMarker[] {
  const scenes = readScenes(values);
  const maps = ownerMaps(entities, knownMaps);
  const markers: QuestMarker[] = [];
  const point = (base: Omit<QuestMarker, 'x' | 'y' | 'z'>, at: { x: number; y: number; z: number }): void => {
    markers.push({ ...base, x: at.x, y: at.y, z: at.z, ...(base.map === null ? { note: NO_MAP_NOTE } : {}) });
  };

  for (const scene of scenes) {
    const owner = scene.owner;
    if (owner.kind === 'areatrigger') {
      if (owner.area) {
        point({ id: `area:${scene.id}`, kind: 'area', label: `${sceneName(scene)} · area`, map: owner.area.map, draggable: true, radius: owner.area.radius }, owner.area);
      }
    }
    const map = owner.kind === 'areatrigger' ? (owner.area?.map ?? null) : (maps.get(`${owner.kind}:${owner.entry}`) ?? null);
    scene.steps.forEach((step, i) => {
      if (step.kind === 'moveTo' || step.kind === 'spawnNpc' || step.kind === 'spawnObject') {
        point({ id: `scene:${scene.id}:${i}:at`, kind: 'scenePoint', label: `${sceneName(scene)} · step ${i + 1}`, map, draggable: true }, step.at);
      } else if (step.kind === 'startEscort') {
        step.points.forEach((p, n) =>
          point({ id: `scene:${scene.id}:${i}:point:${n}`, kind: 'escortPoint', label: `${sceneName(scene)} · escort point ${n + 1}`, map, draggable: true }, p),
        );
      }
    });
  }

  for (const npc of entities.npcs) {
    const map = npc.spawns[0]?.map ?? null;
    npc.fight?.reactions.forEach((reaction, r) => {
      reaction.steps.forEach((step, s) => {
        if (step.kind !== 'summonAdds' || step.at === 'aroundMe') return;
        point({
          id: `fight:${npc.entry}:${reaction.id}:${s}`, kind: 'fightPoint',
          label: `${npcName(npc.name, npc.entry)} fight · reaction ${r + 1} step ${s + 1}`, map, draggable: true,
        }, step.at);
      });
    });
  }

  const points = rowsOf(values.quest_poi_points);
  for (const poi of rowsOf(values.quest_poi)) {
    const id = num(poi.id);
    const outline = points
      .filter((p) => num(p.Idx1) === id)
      .sort((a, b) => num(a.Idx2) - num(b.Idx2))
      .map((p) => ({ x: num(p.X), y: num(p.Y) }));
    if (outline.length === 0) continue;
    const x = outline.reduce((sum, p) => sum + p.x, 0) / outline.length;
    const y = outline.reduce((sum, p) => sum + p.y, 0) / outline.length;
    markers.push({ id: `poi:${id}`, kind: 'poi', label: `Map marker ${id}`, map: num(poi.MapID), x, y, z: 0, draggable: false, outline });
  }
  return markers;
}

type To = { x: number; y: number; z: number };

/**
 * Places one of the project's own spawns as the 3D view left it: where it stands, its facing, and for
 * an object its whole rotation (an NPC only turns). Null for a spawn that is not the project's.
 */
export function placeSpawn(
  entities: ProjectEntities,
  id: string,
  to: { x: number; y: number; z: number; orientation: number; rotation: [number, number, number, number] | null },
): EntitiesEdit {
  const [prefix, kind, entryText, guidText] = id.split(':');
  if (prefix !== 'spawn' || (kind !== 'npc' && kind !== 'obj')) return null;
  const entry = Number(entryText);
  const guid = Number(guidText);
  const owners: { entry: number; spawns: { guid: number }[] }[] = kind === 'npc' ? entities.npcs : entities.objects;
  if (!owners.some((e) => e.entry === entry && e.spawns.some((s) => s.guid === guid))) return null;
  const rotation = kind === 'obj' ? to.rotation : null;
  const place = <T extends { entry: number; spawns: { guid: number }[] }>(list: T[]): T[] =>
    list.map((e) =>
      e.entry !== entry ? e : { ...e, spawns: e.spawns.map((s) => (s.guid === guid ? { ...s, x: to.x, y: to.y, z: to.z, o: to.orientation, rotation } : s)) },
    );
  return kind === 'npc' ? { ...entities, npcs: place(entities.npcs) } : { ...entities, objects: place(entities.objects) };
}
const moved = (p: Position, to: To): Position => ({ ...p, x: to.x, y: to.y, z: to.z });

export function moveMarker(values: Values, entities: ProjectEntities, id: string, to: To): MarkerEdit {
  const parts = id.split(':');
  if (parts[0] === 'scene' || parts[0] === 'area') {
    const { scenes, unreadable } = splitScenes(values);
    const index = scenes.findIndex((s) => s.id === parts[1]);
    const scene = scenes[index];
    if (!scene) return null;
    let next: QuestScene | null = null;
    if (parts[0] === 'area') {
      if (scene.owner.kind === 'areatrigger' && scene.owner.area) next = { ...scene, owner: { ...scene.owner, area: { ...scene.owner.area, x: to.x, y: to.y, z: to.z } } };
    } else {
      const i = Number(parts[2]);
      const step = scene.steps[i];
      let changed: SceneStep | null = null;
      if (step && parts[3] === 'at' && (step.kind === 'moveTo' || step.kind === 'spawnNpc' || step.kind === 'spawnObject')) {
        changed = { ...step, at: moved(step.at, to) };
      } else if (step && parts[3] === 'point' && step.kind === 'startEscort') {
        const n = Number(parts[4]);
        if (step.points[n]) changed = { ...step, points: step.points.map((p, k) => (k === n ? moved(p, to) : p)) };
      }
      if (changed) next = { ...scene, steps: scene.steps.map((s, k) => (k === i ? changed! : s)) };
    }
    return next ? { field: SCRIPTS_FIELD, value: writeScenes(scenes.map((s, k) => (k === index ? next! : s)), unreadable) } : null;
  }
  if (parts[0] === 'fight') {
    const [, entryText, reactionId, stepText] = parts;
    const npc = entities.npcs.find((n) => n.entry === Number(entryText));
    const reaction = npc?.fight?.reactions.find((r) => r.id === reactionId);
    const s = Number(stepText);
    const step = reaction?.steps[s];
    if (!npc || !npc.fight || !reaction || !step || step.kind !== 'summonAdds' || step.at === 'aroundMe') return null;
    const nextStep = { ...step, at: moved(step.at, to) };
    const fight = { ...npc.fight, reactions: npc.fight.reactions.map((r) => (r === reaction ? { ...r, steps: r.steps.map((x, k) => (k === s ? nextStep : x)) } : r)) };
    return { entities: { ...entities, npcs: entities.npcs.map((n) => (n === npc ? { ...n, fight } : n)) } };
  }
  return null;
}

export function addSpawn(
  entities: ProjectEntities,
  target: { kind: 'npc' | 'object'; entry: number },
  spawn: { guid: number; map: number; x: number; y: number; z: number; o: number },
): EntitiesEdit {
  const add = <T extends { entry: number; spawns: ReturnType<typeof newSpawn>[] }>(list: T[]): T[] | null => {
    if (!list.some((e) => e.entry === target.entry)) return null;
    return list.map((e) => (e.entry === target.entry ? { ...e, spawns: [...e.spawns, { ...newSpawn(spawn.guid), ...spawn }] } : e));
  };
  if (target.kind === 'npc') {
    const npcs = add(entities.npcs);
    return npcs ? { ...entities, npcs } : null;
  }
  const objects = add(entities.objects);
  return objects ? { ...entities, objects } : null;
}

/** Takes one of the project's own spawns away; null when it has no such spawn */
export function removeSpawn(entities: ProjectEntities, target: { kind: 'npc' | 'object'; entry: number }, guid: number): EntitiesEdit {
  const remove = <T extends { entry: number; spawns: { guid: number }[] }>(list: T[]): T[] | null => {
    const owner = list.find((e) => e.entry === target.entry);
    if (!owner || !owner.spawns.some((s) => s.guid === guid)) return null;
    return list.map((e) => (e === owner ? { ...e, spawns: e.spawns.filter((s) => s.guid !== guid) } : e));
  };
  if (target.kind === 'npc') {
    const npcs = remove(entities.npcs);
    return npcs ? { ...entities, npcs } : null;
  }
  const objects = remove(entities.objects);
  return objects ? { ...entities, objects } : null;
}

/** How long one of the project's own spawns takes to respawn; null when it has no such spawn */
export function setSpawnRespawn(entities: ProjectEntities, kind: 'npc' | 'object', entry: number, guid: number, secs: number): EntitiesEdit {
  const timed = <T extends { entry: number; spawns: { guid: number; respawnSecs: number }[] }>(list: T[]): T[] | null => {
    const owner = list.find((e) => e.entry === entry);
    if (!owner || !owner.spawns.some((s) => s.guid === guid)) return null;
    return list.map((e) => (e === owner ? { ...e, spawns: e.spawns.map((s) => (s.guid === guid ? { ...s, respawnSecs: secs } : s)) } : e));
  };
  if (kind === 'npc') {
    const npcs = timed(entities.npcs);
    return npcs ? { ...entities, npcs } : null;
  }
  const objects = timed(entities.objects);
  return objects ? { ...entities, objects } : null;
}

/** One of the project's own NPC spawns' own game events ('npc' follows its NPC); null when the project does not have it */
export function setSpawnEventSetting(entities: ProjectEntities, entry: number, guid: number, to: SpawnEvents): EntitiesEdit {
  const owner = entities.npcs.find((n) => n.entry === entry);
  if (!owner || !owner.spawns.some((s) => s.guid === guid)) return null;
  const npcs = entities.npcs.map((n) => (n === owner ? { ...n, spawns: n.spawns.map((s) => (s.guid === guid ? { ...s, events: to } : s)) } : n));
  return { ...entities, npcs };
}

/**
 * How one of the project's own NPC spawns moves: a path keeps the patrol it has (a new one when its id
 * differs), wander and standing still drop the patrol. Null when there is no such spawn.
 */
export function setSpawnMovement(entities: ProjectEntities, entry: number, guid: number, to: Movement): EntitiesEdit {
  const npc = entities.npcs.find((n) => n.entry === entry);
  if (!npc || !npc.spawns.some((s) => s.guid === guid)) return null;
  const spawns = npc.spawns.map((s) => {
    if (s.guid !== guid) return s;
    if (to.type === 'path') return { ...s, wander: 0, patrol: s.patrol && s.patrol.pathId === to.pathId ? s.patrol : newPatrol(to.pathId ?? 0) };
    return { ...s, wander: to.type === 'wander' ? to.wander : 0, patrol: null };
  });
  return { ...entities, npcs: entities.npcs.map((n) => (n === npc ? { ...n, spawns } : n)) };
}

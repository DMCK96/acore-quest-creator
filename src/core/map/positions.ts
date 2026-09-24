import { ENTITIES_FIELD, newSpawn, readEntities, writeEntities, type QuestEntities } from '../entities/model';
import type { FieldValue } from '../registry/types';
import { readScenes, SCRIPTS_FIELD, writeScenes, type Position, type QuestScene, type SceneStep } from '../scripts/model';

/**
 * Every position a quest uses, as markers for its map, and the edits a map makes: moving one
 * position, or adding a spawn. A marker's id names where its position lives, so a move changes
 * exactly that one value.
 */

export type MarkerKind = 'npcSpawn' | 'objectSpawn' | 'scenePoint' | 'escortPoint' | 'fightPoint' | 'area' | 'poi';

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
type Edit = { field: string; value: FieldValue } | null;

const NO_MAP_NOTE = 'Its NPC has no spawn yet, so its map is not known.';

const sceneName = (scene: QuestScene): string => scene.name.trim() || `Scene ${scene.id}`;
const npcName = (name: string, entry: number): string => name.trim() || `New NPC ${entry}`;
const objectName = (name: string, entry: number): string => name.trim() || `New object ${entry}`;

/** The map of the quest's own NPCs and objects, from their first spawn, overriding what the database says. */
function ownerMaps(entities: QuestEntities, knownMaps: ReadonlyMap<string, number>): Map<string, number> {
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

export function questMarkers(values: Values, knownMaps: ReadonlyMap<string, number> = new Map()): QuestMarker[] {
  const entities = readEntities(values);
  const scenes = readScenes(values);
  const maps = ownerMaps(entities, knownMaps);
  const markers: QuestMarker[] = [];
  const point = (base: Omit<QuestMarker, 'x' | 'y' | 'z'>, at: { x: number; y: number; z: number }): void => {
    markers.push({ ...base, x: at.x, y: at.y, z: at.z, ...(base.map === null ? { note: NO_MAP_NOTE } : {}) });
  };

  for (const npc of entities.npcs) {
    npc.spawns.forEach((s, i) =>
      point({ id: `spawn:npc:${npc.entry}:${s.guid}`, kind: 'npcSpawn', label: `${npcName(npc.name, npc.entry)} · spawn ${i + 1}`, map: s.map, draggable: true }, s),
    );
  }
  for (const object of entities.objects) {
    object.spawns.forEach((s, i) =>
      point({ id: `spawn:obj:${object.entry}:${s.guid}`, kind: 'objectSpawn', label: `${objectName(object.name, object.entry)} · spawn ${i + 1}`, map: s.map, draggable: true }, s),
    );
  }

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
const moved = (p: Position, to: To): Position => ({ ...p, x: to.x, y: to.y, z: to.z });

export function moveMarker(values: Values, id: string, to: To): Edit {
  const parts = id.split(':');
  if (parts[0] === 'spawn') {
    const [, kind, entryText, guidText] = parts;
    const entry = Number(entryText);
    const guid = Number(guidText);
    const entities = readEntities(values);
    const owners: { entry: number; spawns: { guid: number }[] }[] = kind === 'npc' ? entities.npcs : kind === 'obj' ? entities.objects : [];
    if (!owners.some((e) => e.entry === entry && e.spawns.some((s) => s.guid === guid))) return null;
    const move = <T extends { entry: number; spawns: { guid: number; x: number; y: number; z: number }[] }>(list: T[]): T[] =>
      list.map((e) => (e.entry !== entry ? e : { ...e, spawns: e.spawns.map((s) => (s.guid === guid ? { ...s, x: to.x, y: to.y, z: to.z } : s)) }));
    const next = kind === 'npc' ? { ...entities, npcs: move(entities.npcs) } : { ...entities, objects: move(entities.objects) };
    return { field: ENTITIES_FIELD, value: writeEntities(next) };
  }
  if (parts[0] === 'scene' || parts[0] === 'area') {
    const scenes = readScenes(values);
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
    return next ? { field: SCRIPTS_FIELD, value: writeScenes(scenes.map((s, k) => (k === index ? next! : s))) } : null;
  }
  if (parts[0] === 'fight') {
    const [, entryText, reactionId, stepText] = parts;
    const entities = readEntities(values);
    const npc = entities.npcs.find((n) => n.entry === Number(entryText));
    const reaction = npc?.fight?.reactions.find((r) => r.id === reactionId);
    const s = Number(stepText);
    const step = reaction?.steps[s];
    if (!npc || !npc.fight || !reaction || !step || step.kind !== 'summonAdds' || step.at === 'aroundMe') return null;
    const nextStep = { ...step, at: moved(step.at, to) };
    const fight = { ...npc.fight, reactions: npc.fight.reactions.map((r) => (r === reaction ? { ...r, steps: r.steps.map((x, k) => (k === s ? nextStep : x)) } : r)) };
    return { field: ENTITIES_FIELD, value: writeEntities({ ...entities, npcs: entities.npcs.map((n) => (n === npc ? { ...n, fight } : n)) }) };
  }
  return null;
}

export function addSpawn(
  values: Values,
  target: { kind: 'npc' | 'object'; entry: number },
  spawn: { guid: number; map: number; x: number; y: number; z: number; o: number },
): Edit {
  const entities = readEntities(values);
  const add = <T extends { entry: number; spawns: ReturnType<typeof newSpawn>[] }>(list: T[]): T[] | null => {
    if (!list.some((e) => e.entry === target.entry)) return null;
    return list.map((e) => (e.entry === target.entry ? { ...e, spawns: [...e.spawns, { ...newSpawn(spawn.guid), ...spawn }] } : e));
  };
  if (target.kind === 'npc') {
    const npcs = add(entities.npcs);
    return npcs ? { field: ENTITIES_FIELD, value: writeEntities({ ...entities, npcs }) } : null;
  }
  const objects = add(entities.objects);
  return objects ? { field: ENTITIES_FIELD, value: writeEntities({ ...entities, objects }) } : null;
}

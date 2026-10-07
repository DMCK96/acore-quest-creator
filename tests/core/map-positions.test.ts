import { describe, expect, it } from 'vitest';
import { addSpawn, moveMarker, questMarkers } from '../../src/core/map/positions';
import { newNpc, newSpawn, type ProjectEntities } from '../../src/core/entities/model';
import type { MarkerEdit } from '../../src/core/map/positions';
import { SCRIPTS_FIELD, readScenes, writeScenes, type QuestScene } from '../../src/core/scripts/model';
import { emptyFight } from '../../src/core/combat/model';

const at = (x: number, y: number, z = 0) => ({ x, y, z, o: 1 });
const hela = { ...newNpc(12000001), name: 'Hela', spawns: [{ ...newSpawn(900), map: 0, x: -8900, y: -160, z: 82 }], fight: {
  ...emptyFight(), reactions: [{ id: 'r1', when: { kind: 'healthBelow' as const, pct: 50 }, phases: [], steps: [{ kind: 'summonAdds' as const, entry: 7, count: 1, at: at(-8910, -170), attack: false, waitMs: 0 }] }],
} };
const scenes: QuestScene[] = [
  { id: 's1', name: 'Walk', owner: { kind: 'creature', entry: 12000001 }, trigger: { kind: 'questAccepted' }, gates: [], steps: [
    { kind: 'moveTo', at: at(-8905, -165), waitMs: 0 },
    { kind: 'startEscort', points: [at(-8901, -161), at(-8902, -162)], run: false, waitMs: 0 },
  ] },
  { id: 's2', name: '', owner: { kind: 'creature', entry: 197 }, trigger: { kind: 'questAccepted' }, gates: [], steps: [{ kind: 'spawnNpc', entry: 7, at: at(5, 5), despawnAfterS: 0, attackPlayer: false, waitMs: 0 }] },
  { id: 's3', name: 'Enter', owner: { kind: 'areatrigger', id: 0, area: { map: 0, x: -8800, y: -100, z: 80, radius: 12 } }, trigger: { kind: 'enterArea' }, gates: [], steps: [] },
];
const store: ProjectEntities = { npcs: [hela], objects: [], items: [] };
/** The project's NPCs and objects a marker move changed */
const ents = (edit: MarkerEdit): ProjectEntities => (edit as { entities: ProjectEntities }).entities;
/** The quest's scenes a marker move changed */
const sc = (edit: MarkerEdit) => readScenes({ [SCRIPTS_FIELD]: (edit as { value: unknown }).value });
const values = {
  [SCRIPTS_FIELD]: writeScenes(scenes),
  quest_poi: [{ id: 0, ObjectiveIndex: 0, MapID: 0, WorldMapAreaId: 12, Floor: 0, Priority: 0, Flags: 0, VerifiedBuild: 0 }],
  quest_poi_points: [{ Idx1: 0, Idx2: 0, X: -8900, Y: -100, VerifiedBuild: 0 }, { Idx1: 0, Idx2: 1, X: -8800, Y: -200, VerifiedBuild: 0 }],
} as Record<string, unknown>;

describe('questMarkers', () => {
  it('collects every position the quest uses, with the right maps', () => {
    const markers = questMarkers(values, store, new Map([['creature:197', 0]]));
    const byId = new Map(markers.map((m) => [m.id, m]));
    expect(byId.has('spawn:npc:12000001:900')).toBe(false);
    expect(byId.get('scene:s1:0:at')).toMatchObject({ kind: 'scenePoint', label: 'Walk · step 1', map: 0, x: -8905 });
    expect(byId.get('scene:s1:1:point:1')).toMatchObject({ kind: 'escortPoint', label: 'Walk · escort point 2', map: 0, x: -8902 });
    expect(byId.get('scene:s2:0:at')).toMatchObject({ label: 'Scene s2 · step 1', map: 0 });
    expect(byId.get('fight:12000001:r1:0')).toMatchObject({ kind: 'fightPoint', label: 'Hela fight · reaction 1 step 1', map: 0 });
    expect(byId.get('area:s3')).toMatchObject({ kind: 'area', map: 0, radius: 12, draggable: true });
    expect(byId.get('poi:0')).toMatchObject({ kind: 'poi', map: 0, draggable: false, outline: [{ x: -8900, y: -100 }, { x: -8800, y: -200 }] });
  });
  it('says when a point has no map to go on', () => {
    const markers = questMarkers(values, store);
    expect(markers.find((m) => m.id === 'scene:s2:0:at')).toMatchObject({ map: null, note: 'Its NPC has no spawn yet, so its map is not known.' });
  });
});

describe('moveMarker', () => {
  it('moves one escort point and nothing else in the scene', () => {
    const out = moveMarker(values, store, 'scene:s1:1:point:1', { x: 7, y: 8, z: 9 })!;
    const s = sc(out);
    expect(s[0]!.steps[1]).toEqual({ ...scenes[0]!.steps[1]!, points: [at(-8901, -161), { x: 7, y: 8, z: 9, o: 1 }] });
    expect(s[0]!.steps[0]).toEqual(scenes[0]!.steps[0]);
    expect(s[1]).toEqual(scenes[1]);
  });
  it('moves a fight summon point and an area', () => {
    const fight = moveMarker(values, store, 'fight:12000001:r1:0', { x: 1, y: 1, z: 1 })!;
    expect(ents(fight).npcs[0]!.fight!.reactions[0]!.steps[0]).toMatchObject({ at: { x: 1, y: 1, z: 1, o: 1 } });
    const area = moveMarker(values, store, 'area:s3', { x: 2, y: 2, z: 2 })!;
    expect(sc(area)[2]!.owner).toEqual({ kind: 'areatrigger', id: 0, area: { map: 0, x: 2, y: 2, z: 2, radius: 12 } });
  });
  it('refuses read-only and unknown markers', () => {
    expect(moveMarker(values, store, 'poi:0', { x: 0, y: 0, z: 0 })).toBeNull();
    expect(moveMarker(values, store, 'spawn:npc:12000001:900', { x: 0, y: 0, z: 0 })).toBeNull();
  });
});

describe('addSpawn', () => {
  it('adds a spawn to a new NPC with the usual defaults', () => {
    const out = addSpawn(store, { kind: 'npc', entry: 12000001 }, { guid: 901, map: 0, x: 1, y: 2, z: 3, o: 0 })!;
    expect(out.npcs[0]!.spawns[1]).toEqual({ ...newSpawn(901), map: 0, x: 1, y: 2, z: 3, o: 0 });
    expect(addSpawn(store, { kind: 'object', entry: 1 }, { guid: 1, map: 0, x: 0, y: 0, z: 0, o: 0 })).toBeNull();
  });
});

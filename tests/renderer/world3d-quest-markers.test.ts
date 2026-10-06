import { describe, expect, it } from 'vitest';
import { MARKER_KINDS, markersOnMap, worldMarkers } from '../../src/renderer/world3d/quest-markers';
import { newNpc, newSpawn, type ProjectEntities } from '../../src/core/entities/model';
import { emptyFight } from '../../src/core/combat/model';
import { addPoint, newPatrol } from '../../src/core/map/patrol';
import { SCRIPTS_FIELD, writeScenes, type QuestScene } from '../../src/core/scripts/model';

const at = (x: number, y: number, z = 0) => ({ x, y, z, o: 1 });
const hela = { ...newNpc(12000001), name: 'Hela', spawns: [{ ...newSpawn(900), map: 0, x: -8900, y: -160, z: 82, patrol: addPoint(newPatrol(9000), { x: 1, y: 1, z: 0 }) }], fight: {
  ...emptyFight(), reactions: [{ id: 'r1', when: { kind: 'healthBelow' as const, pct: 50 }, phases: [], steps: [{ kind: 'summonAdds' as const, entry: 7, count: 1, at: at(-8910, -170), attack: false, waitMs: 0 }] }],
} };
const scenes: QuestScene[] = [
  { id: 's1', name: 'Walk', owner: { kind: 'creature', entry: 12000001 }, trigger: { kind: 'questAccepted' }, gates: [], steps: [
    { kind: 'moveTo', at: at(-8905, -165), waitMs: 0 },
    { kind: 'startEscort', points: [at(-8901, -161)], run: false, waitMs: 0 },
  ] },
  { id: 's2', name: 'Far', owner: { kind: 'creature', entry: 197 }, trigger: { kind: 'questAccepted' }, gates: [], steps: [{ kind: 'spawnNpc', entry: 7, at: at(5, 5), despawnAfterS: 0, attackPlayer: false, waitMs: 0 }] },
  { id: 's3', name: 'Enter', owner: { kind: 'areatrigger', id: 0, area: { map: 1, x: -8800, y: -100, z: 80, radius: 12 } }, trigger: { kind: 'enterArea' }, gates: [], steps: [] },
];
const store: ProjectEntities = { npcs: [hela], objects: [], items: [] };
const values = {
  [SCRIPTS_FIELD]: writeScenes(scenes),
  quest_poi: [{ id: 0, ObjectiveIndex: 0, MapID: 0, WorldMapAreaId: 12, Floor: 0, Priority: 0, Flags: 0, VerifiedBuild: 0 }],
  quest_poi_points: [{ Idx1: 0, Idx2: 0, X: -8900, Y: -100, VerifiedBuild: 0 }, { Idx1: 0, Idx2: 1, X: -8800, Y: -200, VerifiedBuild: 0 }],
} as Record<string, unknown>;

describe('the quest positions the World draws', () => {
  it('are its script, escort, fight, area and map-marker positions; its own spawns and patrols are drawn as spawns already', () => {
    const ids = worldMarkers(values, store).map((m) => m.id);
    expect(ids.sort()).toEqual(['area:s3', 'fight:12000001:r1:0', 'poi:0', 'scene:s1:0:at', 'scene:s1:1:point:0', 'scene:s2:0:at']);
  });

  it('keeps each marker’s place, whether it can be dragged, its radius and outline', () => {
    const byId = new Map(worldMarkers(values, store).map((m) => [m.id, m]));
    expect(byId.get('scene:s1:0:at')).toMatchObject({ kind: 'scenePoint', label: 'Walk · step 1', map: 0, x: -8905, y: -165, draggable: true });
    expect(byId.get('area:s3')).toMatchObject({ kind: 'area', map: 1, radius: 12, draggable: true });
    expect(byId.get('poi:0')).toMatchObject({ kind: 'poi', draggable: false, outline: [{ x: -8900, y: -100 }, { x: -8800, y: -200 }] });
    expect(byId.get('scene:s2:0:at')).toMatchObject({ map: null, note: 'Its NPC has no spawn yet, so its map is not known.' });
  });

  it('names each kind', () => {
    expect(MARKER_KINDS).toEqual({ scenePoint: 'Scene step', escortPoint: 'Escort point', fightPoint: 'Fight: summoned adds', area: 'Area trigger', poi: 'Quest POI' });
  });

  it('on a map: those on it, and those whose map is not known (drawn where the author is, as the quest map did)', () => {
    const markers = worldMarkers(values, store);
    expect(markersOnMap(markers, 0).map((m) => m.id).sort()).toEqual(['fight:12000001:r1:0', 'poi:0', 'scene:s1:0:at', 'scene:s1:1:point:0', 'scene:s2:0:at']);
    expect(markersOnMap(markers, 1).map((m) => m.id).sort()).toEqual(['area:s3', 'scene:s2:0:at']);
  });

  it('gives none for a quest with no positions', () => {
    expect(worldMarkers({}, { npcs: [], objects: [], items: [] })).toEqual([]);
  });
});

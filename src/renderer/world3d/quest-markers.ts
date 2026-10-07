import type { ProjectEntities } from '@core/entities/model';
import { questMarkers, type MarkerKind, type QuestMarker } from '@core/map/positions';

/**
 * The open quest's positions the World draws as markers: its scene steps' points, escort points, fight
 * summon points, areatrigger areas and its POI outlines. Its own NPC and object spawns and their patrols
 * are not among them: the World draws those as spawns already.
 */

export type WorldMarkerKind = Exclude<MarkerKind, 'npcSpawn' | 'objectSpawn' | 'patrolPoint'>;
export type WorldMarker = QuestMarker & { kind: WorldMarkerKind };

/** What each kind of marker is, as its card names it */
export const MARKER_KINDS: Record<WorldMarkerKind, string> = {
  scenePoint: 'Scene step',
  escortPoint: 'Escort point',
  fightPoint: 'Fight: summoned adds',
  area: 'Area trigger',
  poi: 'Quest POI',
};

const isWorldMarker = (m: QuestMarker): m is WorldMarker => m.kind in MARKER_KINDS;

export function worldMarkers(values: Readonly<Record<string, unknown>>, entities: ProjectEntities): WorldMarker[] {
  return questMarkers(values, entities).filter(isWorldMarker);
}

/** The markers drawn on a map: those on it, and those whose map is not known (drawn wherever the author is) */
export function markersOnMap(markers: readonly WorldMarker[], map: number): WorldMarker[] {
  return markers.filter((m) => m.map === map || m.map === null);
}

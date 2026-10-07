import type { TransportInfo } from './transports';

/**
 * The maps the 3D view can draw, by the folder name their terrain lives under in the client
 * (`World\Maps\<name>\<name>.wdt`), each with a place to start looking. The four continents are listed
 * here, each starting in a city or starting area that is on the ground; the other maps (dungeons,
 * raids, battlegrounds, arenas) come from the game client's `Map.dbc` once it is read (`setClientMaps`).
 * A map stored as a single building (most dungeons) has no terrain: it draws as that one building (`wmo`).
 */
export type MapKind = 'continent' | 'world' | 'dungeon' | 'raid' | 'battleground' | 'arena' | 'transport';

export interface WorldMap {
  id: number;
  name: string;
  directory: string;
  kind: MapKind;
  start: { x: number; y: number; z: number };
  /** The one building a map without terrain tiles is made of (a dungeon stored as a single WMO), placed at the world's origin */
  wmo?: { path: string; doodadSet: number };
  /** A transport's map (a ship, zeppelin or lift): its templates and their routes, drawn on the terrain they pass over */
  transport?: TransportInfo;
}

export const WORLD_MAPS: readonly WorldMap[] = [
  { id: 0, name: 'Eastern Kingdoms', directory: 'azeroth', kind: 'continent', start: { x: -8949.95, y: -132.49, z: 83.5 } }, // Northshire Valley
  { id: 1, name: 'Kalimdor', directory: 'kalimdor', kind: 'continent', start: { x: 1629.36, y: -4373.39, z: 31.2 } }, // Orgrimmar
  { id: 530, name: 'Outland', directory: 'expansion01', kind: 'continent', start: { x: -1838.16, y: 5301.79, z: -12.43 } }, // Shattrath City
  { id: 571, name: 'Northrend', directory: 'northrend', kind: 'continent', start: { x: 5804.15, y: 624.77, z: 647.77 } }, // Dalaran
];

let clientMaps: readonly WorldMap[] = [];
let all: readonly WorldMap[] = WORLD_MAPS;
const listeners = new Set<() => void>();

/** Every map the view can draw: the continents, then the client's others by name */
export const worldMaps = (): readonly WorldMap[] => all;

/** Sets the maps read from the game client (none when it has none); anyone watching is told */
export function setClientMaps(maps: readonly WorldMap[]): void {
  clientMaps = maps;
  all = [...WORLD_MAPS, ...maps];
  for (const listener of listeners) listener();
}

/** Calls `listener` whenever the client's maps change; returns the way to stop */
export function onWorldMapsChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const worldMapById = (id: number): WorldMap | null => WORLD_MAPS.find((m) => m.id === id) ?? clientMaps.find((m) => m.id === id) ?? null;

/** The client folder of a map's terrain; null when the 3D view cannot draw that map. */
export function worldMapDirectory(map: number): string | null {
  return worldMapById(map)?.directory ?? null;
}

const GROUP_LABELS: Record<MapKind, string> = {
  continent: 'Continents',
  world: 'Other maps',
  dungeon: 'Dungeons',
  raid: 'Raids',
  battleground: 'Battlegrounds',
  arena: 'Arenas',
  transport: 'Transports',
};

/** Maps by what they are, continents first, for a picker; empty groups are left out */
export function groupWorldMaps(maps: readonly WorldMap[]): { label: string; maps: WorldMap[] }[] {
  return (Object.keys(GROUP_LABELS) as MapKind[])
    .map((kind) => ({ label: GROUP_LABELS[kind], maps: maps.filter((m) => m.kind === kind) }))
    .filter((group) => group.maps.length > 0);
}

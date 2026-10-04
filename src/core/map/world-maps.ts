/**
 * The continents the 3D view can draw, by the folder name their terrain lives under in the client
 * (`World\Maps\<name>\<name>.wdt`), each with a place to start looking: a city or starting area that
 * is on the ground. Other maps (dungeons, battlegrounds) need their own WDT handling and are not
 * drawn yet.
 */
export interface WorldMap {
  id: number;
  name: string;
  directory: string;
  start: { x: number; y: number; z: number };
}

export const WORLD_MAPS: readonly WorldMap[] = [
  { id: 0, name: 'Eastern Kingdoms', directory: 'azeroth', start: { x: -8949.95, y: -132.49, z: 83.5 } }, // Northshire Valley
  { id: 1, name: 'Kalimdor', directory: 'kalimdor', start: { x: 1629.36, y: -4373.39, z: 31.2 } }, // Orgrimmar
  { id: 530, name: 'Outland', directory: 'expansion01', start: { x: -1838.16, y: 5301.79, z: -12.43 } }, // Shattrath City
  { id: 571, name: 'Northrend', directory: 'northrend', start: { x: 5804.15, y: 624.77, z: 647.77 } }, // Dalaran
];

export const worldMapById = (id: number): WorldMap | null => WORLD_MAPS.find((m) => m.id === id) ?? null;

/** The client folder of a map's terrain; null when the 3D view cannot draw that map. */
export function worldMapDirectory(map: number): string | null {
  return worldMapById(map)?.directory ?? null;
}

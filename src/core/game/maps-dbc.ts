import { dbcFloat, dbcString, parseDbc } from './dbc';

/**
 * Map names and zone labels from the server's client data: `Map.dbc` names each map and says
 * whether it is an instance; `WorldMapArea.dbc` gives each zone's box on its map, and
 * `AreaTable.dbc` the zone's name.
 */

export const MAP_FILE = 'Map.dbc';
export const WORLD_MAP_AREA_FILE = 'WorldMapArea.dbc';
export const AREA_TABLE_FILE = 'AreaTable.dbc';

/** `MapEntry`: 0 id, 2 `map_type` (0 = the open world), 5 the enUS name. */
export function parseMapNames(bytes: Uint8Array): Map<number, { name: string; instance: boolean }> {
  const table = parseDbc(bytes, MAP_FILE);
  return new Map(table.records.map((r) => [r[0]!, { name: dbcString(bytes, r[5]!), instance: r[2]! !== 0 }]));
}

/** `MapEntry` 1: each map's folder name in the client (`Azeroth`, `Kalimdor`, `Expansion01`, …). */
export function parseMapDirectories(bytes: Uint8Array): Map<number, string> {
  return new Map(parseDbc(bytes, MAP_FILE).records.map((r) => [r[0]!, dbcString(bytes, r[1]!)]));
}

/** Each zone's name at the middle of its world map box: `WorldMapAreaEntry` 1 map, 2 area, 4–7 y1, y2, x1, x2. */
export function parseZoneLabels(worldMapArea: Uint8Array, areaTable: Uint8Array): { map: number; name: string; x: number; y: number }[] {
  const areas = parseDbc(areaTable, AREA_TABLE_FILE);
  const names = new Map(areas.records.map((r) => [r[0]!, dbcString(areaTable, r[11]!)]));
  const labels: { map: number; name: string; x: number; y: number }[] = [];
  for (const r of parseDbc(worldMapArea, WORLD_MAP_AREA_FILE).records) {
    const name = names.get(r[2]!);
    if (r[2] === 0 || !name) continue;
    const [y1, y2, x1, x2] = [r[4]!, r[5]!, r[6]!, r[7]!].map(dbcFloat) as [number, number, number, number];
    labels.push({ map: r[1]!, name, x: (x1 + x2) / 2, y: (y1 + y2) / 2 });
  }
  return labels;
}

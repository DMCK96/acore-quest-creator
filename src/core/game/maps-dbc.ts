import { dbcString, parseDbc } from './dbc';

/**
 * Map names from the server's client data: `Map.dbc` names each map and says whether it is an
 * instance.
 */

export const MAP_FILE = 'Map.dbc';
export const AREA_TABLE_FILE = 'AreaTable.dbc';

/** `MapEntry`: 0 id, 2 `map_type` (0 = the open world), 5 the enUS name. */
export function parseMapNames(bytes: Uint8Array): Map<number, { name: string; instance: boolean }> {
  const table = parseDbc(bytes, MAP_FILE);
  return new Map(table.records.map((r) => [r[0]!, { name: dbcString(bytes, r[5]!), instance: r[2]! !== 0 }]));
}

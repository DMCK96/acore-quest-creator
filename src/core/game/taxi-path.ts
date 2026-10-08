import { DbcFormatError, dbcFloat, parseDbc } from './dbc';

export const TAXI_PATH_NODE_FILE = 'TaxiPathNode.dbc';
/** Node flags: the vessel jumps to the next node instead of travelling, or waits there. */
export const NODE_TELEPORT = 1;
export const NODE_STOP = 2;

/** Fields we read: id, pathId, nodeIndex, mapId, x, y, z, flags, delay. */
const MIN_FIELDS = 9;

export interface TaxiNode {
  index: number;
  map: number;
  x: number;
  y: number;
  z: number;
  flags: number;
  delay: number;
}

/** TaxiPathNode.dbc as the nodes of each path id, ordered by node index. */
export function parseTaxiPathNodes(bytes: Uint8Array): Map<number, TaxiNode[]> {
  const table = parseDbc(bytes, TAXI_PATH_NODE_FILE);
  if (table.fieldCount < MIN_FIELDS) {
    throw new DbcFormatError(`${TAXI_PATH_NODE_FILE} has ${table.fieldCount} fields; a 3.3.5a file has at least ${MIN_FIELDS}.`);
  }
  const paths = new Map<number, TaxiNode[]>();
  for (const r of table.records) {
    const node: TaxiNode = { index: r[2]!, map: r[3]!, x: dbcFloat(r[4]!), y: dbcFloat(r[5]!), z: dbcFloat(r[6]!), flags: r[7]!, delay: r[8]! };
    const list = paths.get(r[1]!);
    if (list) list.push(node);
    else paths.set(r[1]!, [node]);
  }
  for (const list of paths.values()) list.sort((a, b) => a.index - b.index);
  return paths;
}

import { DbcFormatError, parseDbc } from './dbc';

/**
 * What a vendor asks for besides gold, from the server data folder's `ItemExtendedCost.dbc`
 * (3.3.5a, 16 fields): the id, honor points, arena points, arena slot, five item ids, five item
 * counts, the personal arena rating needed and the purchase group (not read).
 */
export const EXTENDED_COST_FILE = 'ItemExtendedCost.dbc';

/** The fields read; a 3.3.5a file has one more, the purchase group */
const FIELDS = 15;
const FILE_FIELDS = 16;
const ITEM_SLOTS = 5;

export interface ExtendedCost {
  id: number;
  honor: number;
  arena: number;
  rating: number;
  /** The items it takes; empty slots are left out */
  items: { item: number; count: number }[];
}

export function readExtendedCosts(bytes: Uint8Array): Map<number, ExtendedCost> {
  const table = parseDbc(bytes, EXTENDED_COST_FILE);
  if (table.fieldCount < FIELDS) {
    throw new DbcFormatError(`${EXTENDED_COST_FILE} has ${table.fieldCount} fields; a 3.3.5a file has ${FILE_FIELDS}.`);
  }
  const costs = new Map<number, ExtendedCost>();
  for (const r of table.records) {
    const items = Array.from({ length: ITEM_SLOTS }, (_, i) => ({ item: r[4 + i]!, count: r[9 + i]! })).filter((s) => s.item !== 0 && s.count !== 0);
    costs.set(r[0]!, { id: r[0]!, honor: r[1]!, arena: r[2]!, rating: r[14]!, items });
  }
  return costs;
}

/** "2000 honor + 1 Mark of Honor"; a cost that asks for nothing is "No cost" */
export function extendedCostLabel(cost: ExtendedCost, itemName: (id: number) => string | undefined): string {
  const parts: string[] = [];
  if (cost.honor > 0) parts.push(`${cost.honor} honor`);
  if (cost.arena > 0) parts.push(`${cost.arena} arena points`);
  for (const { item, count } of cost.items) parts.push(`${count} ${itemName(item) ?? `item ${item}`}`);
  if (parts.length === 0) return 'No cost';
  return cost.rating > 0 ? `${parts.join(' + ')} (rating ${cost.rating})` : parts.join(' + ');
}

export interface ExtendedCostIndex {
  /** The cost's label */
  get(id: number): string | undefined;
  /** An id typed in full finds that cost alone; otherwise labels starting with the text, then containing it, each by id */
  search(text: string, limit: number): { id: number; name: string }[];
}

export function buildExtendedCostIndex(costs: ReadonlyMap<number, ExtendedCost>, itemName: (id: number) => string | undefined): ExtendedCostIndex {
  const labels = new Map([...costs.values()].map((c) => [c.id, extendedCostLabel(c, itemName)] as const));
  const byId = [...labels.entries()].sort(([a], [b]) => a - b);
  return {
    get: (id) => labels.get(id),
    search(text, limit) {
      const needle = text.trim().toLowerCase();
      if (needle === '') return [];
      if (/^\d+$/.test(needle) && labels.has(Number(needle))) return [{ id: Number(needle), name: labels.get(Number(needle))! }];
      const starts: { id: number; name: string }[] = [];
      const contains: { id: number; name: string }[] = [];
      for (const [id, name] of byId) {
        const at = name.toLowerCase().indexOf(needle);
        if (at === 0) starts.push({ id, name });
        else if (at > 0) contains.push({ id, name });
      }
      return [...starts, ...contains].slice(0, limit);
    },
  };
}

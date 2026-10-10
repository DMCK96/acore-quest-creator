import type { TeleportSpot } from './teleports';

const words = (text: string): string[] => text.toLowerCase().split(/\s+/).filter(Boolean);

/** How well a spot answers a query: 4 exact name, 3 name starts with it, 2 every word in the name, 1 every word in name, zone or region, 0 no */
function score(spot: TeleportSpot, query: string, parts: string[]): number {
  const name = spot.name.toLowerCase();
  if (name === query) return 4;
  if (name.startsWith(query)) return 3;
  if (parts.every((part) => name.includes(part))) return 2;
  const haystack = `${spot.name} ${spot.zone} ${spot.region}`.toLowerCase();
  return parts.every((part) => haystack.includes(part)) ? 1 : 0;
}

/** The spots that match, best first and the table's order within a rank */
export function searchTeleports(spots: readonly TeleportSpot[], query: string, limit: number): TeleportSpot[] {
  const q = query.trim().toLowerCase();
  const parts = words(q);
  if (parts.length === 0) return [];
  return spots
    .map((spot, order) => ({ spot, order, rank: score(spot, q, parts) }))
    .filter((hit) => hit.rank > 0)
    .sort((a, b) => b.rank - a.rank || a.order - b.order)
    .slice(0, limit)
    .map((hit) => hit.spot);
}

/** The one spot a name means: an exact name wins, else a single match; several (or none) come back as candidates */
export function resolveSpot(spots: readonly TeleportSpot[], name: string): { spot: TeleportSpot } | { candidates: TeleportSpot[] } {
  const found = searchTeleports(spots, name, spots.length);
  const exact = found.filter((s) => s.name.toLowerCase() === name.trim().toLowerCase());
  if (exact.length === 1) return { spot: exact[0]! };
  if (exact.length === 0 && found.length === 1) return { spot: found[0]! };
  return { candidates: exact.length > 1 ? exact : found };
}

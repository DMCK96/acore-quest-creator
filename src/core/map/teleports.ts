/**
 * Named places to jump to, from AzerothAdmin's teleport table (`Data/TeleportTable.lua`):
 * https://github.com/superstyro/AzerothAdmin, GPL-3.0-or-later (a derivative of TrinityAdmin and
 * MangAdmin). `scripts/teleports.ts` converts the table into `teleports.json` with this parser; the
 * app ships that file, credited in CREDITS.md.
 */

export interface TeleportSpot {
  /** The part of the world, as the table groups it */
  region: string;
  zone: string;
  name: string;
  map: number;
  x: number;
  y: number;
  z: number;
}

/** The table's region codes, as the panel names them; Northrend comes in two halves, one region here */
export const TELEPORT_REGIONS: Record<string, string> = {
  EK_N: 'Eastern Kingdoms',
  EK_S: 'Eastern Kingdoms',
  K: 'Kalimdor',
  Ou: 'Outland',
  N_A: 'Northrend',
  N_H: 'Northrend',
  BG: 'Battlegrounds',
  I_EK: 'Instances: Eastern Kingdoms',
  I_K: 'Instances: Kalimdor',
  I_O: 'Instances: Outland',
  I_N: 'Instances: Northrend',
  OT: 'Other',
};

const REGION = /cont\s*==\s*"([^"]+)"/;
const ZONE = /^\s*\["([^"]+)"\]\s*=\s*\{\s*$/;
const SPOT = /^\s*\["([^"]+)"\]\s*=\s*"\.go xyz\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s*"/;

/** Every `.go xyz` spot in the table, in its order; other entries and unknown region codes are skipped */
export function parseTeleportLua(text: string): TeleportSpot[] {
  const spots: TeleportSpot[] = [];
  let region: string | null = null;
  let zone = '';
  for (const line of text.split(/\r?\n/)) {
    const regionMatch = REGION.exec(line);
    if (regionMatch) {
      region = TELEPORT_REGIONS[regionMatch[1]!] ?? null;
      continue;
    }
    const zoneMatch = ZONE.exec(line);
    if (zoneMatch) {
      zone = zoneMatch[1]!;
      continue;
    }
    const spot = SPOT.exec(line);
    if (!spot || !region) continue;
    const [x, y, z, map] = spot.slice(2, 6).map(Number) as [number, number, number, number];
    if (![x, y, z, map].every(Number.isFinite)) continue;
    spots.push({ region, zone, name: spot[1]!, map, x, y, z });
  }
  return spots;
}

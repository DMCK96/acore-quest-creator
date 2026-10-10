import { z } from 'zod';
import { resolveSpot, searchTeleports } from '../../../core/map/teleport-search';
import type { TeleportSpot } from '../../../core/map/teleports';
import spots from '../../../core/map/teleports.json';
import { defineTool } from '../tool';

const SPOTS = spots as TeleportSpot[];
const brief = (s: TeleportSpot) => ({ name: s.name, zone: s.zone, region: s.region, map: s.map, x: s.x, y: s.y, z: s.z });
const bad = (message: string, extra: Record<string, unknown> = {}) => ({ ok: false as const, error: { code: 'BAD_REQUEST' as const, message, ...extra } });

/** Moving the 3D view's camera, so the assistant can go and look (then `screenshot`). It changes nothing in the project. */
export const navigationTools = [
  defineTool({
    name: 'camera_status',
    title: 'Where the 3D camera is',
    description: 'The map, position (world coordinates, as teleport takes them) and area the World view\'s camera is at now. Fails when the editor window does not answer.',
    input: {},
    write: false,
    run: (_args, ctx) => ctx.call('cameraStatus'),
  }),
  defineTool({
    name: 'teleport_search',
    title: 'Find named places to teleport to',
    description: 'Named places (cities, towns, landmarks, instances) from the teleport table whose name, zone or region contains every word of the text, best match first, with their map and coordinates.',
    input: { query: z.string().min(1).max(100), limit: z.number().int().min(1).max(50).optional() },
    write: false,
    run: async ({ query, limit }) => ({ ok: true, value: searchTeleports(SPOTS, query, limit ?? 10).map(brief) }),
  }),
  defineTool({
    name: 'teleport',
    title: 'Teleport the 3D camera',
    description:
      'Takes the World view\'s camera to a named place (`spot`, a name from teleport_search; an ambiguous name answers the candidates) or to `map` with `x`, `y`, `z` (all four). The editor\'s Back button returns from it. Answers where the camera landed; follow with `screenshot` to see it. Moves the camera only, never the project.',
    input: {
      spot: z.string().min(1).max(100).optional(),
      map: z.number().int().min(0).optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      z: z.number().optional(),
    },
    write: false,
    run: async ({ spot, map, x, y, z }, ctx) => {
      const coords = [map, x, y, z].filter((v) => v !== undefined).length;
      if (spot !== undefined && coords > 0) return bad('Give a spot or map, x, y and z, not both.');
      if (spot !== undefined) {
        const found = resolveSpot(SPOTS, spot);
        if ('candidates' in found) {
          return bad(found.candidates.length === 0 ? `No place matches "${spot}"; try teleport_search.` : `"${spot}" matches several places; use one of these names exactly.`, { candidates: found.candidates.slice(0, 10).map(brief) });
        }
        return ctx.call('cameraTeleport', { map: found.spot.map, x: found.spot.x, y: found.spot.y, z: found.spot.z });
      }
      if (coords !== 4) return bad('Give a spot, or map, x, y and z together.');
      return ctx.call('cameraTeleport', { map: map!, x: x!, y: y!, z: z! });
    },
  }),
];

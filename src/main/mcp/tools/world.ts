import { z } from 'zod';
import { defineTool } from '../tool';

const kind = z.enum(['creature', 'gameobject']);
const guid = z.number().int().min(1);
const ROTATION_NOTE = 'An object also takes a `rotation` quaternion [x, y, z, w] (how nearby objects are turned is in area_overview; set it for what the object should face); NPCs leave it out.';
const place = {
  x: z.number().describe('World yards, X north.'),
  y: z.number().describe('World yards, Y west.'),
  z: z.number().describe('World yards, Z up.'),
  orientation: z.number().describe('Radians: 0 faces north and it grows toward west (π/2 west, π south, 3π/2 east).'),
  rotation: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional().describe('Objects only: the quaternion x, y, z, w.'),
};
const UNITS = 'Positions are world yards (X north, Y west, Z up); orientation is in radians, 0 faces north and it grows toward west (π/2 west, π south, 3π/2 east). Edits go in the project\'s world layer and become part of the patch; the database is never written.';

/** Placing and moving spawns, paths, movement and respawn times in the world. */
export const worldTools = [
  defineTool({
    name: 'add_spawn',
    title: 'Place an NPC or object',
    description: `Places a new spawn of an existing NPC (creature) or object (gameobject) entry on a map, and answers its new guid. ${UNITS} ${ROTATION_NOTE}`,
    input: { kind, entry: z.number().int().min(1), map: z.number().int().min(0), ...place },
    write: { kind: 'step', label: ({ kind, entry }: { kind: string; entry: number }) => `AI: place ${kind} ${entry}` },
    run: async ({ kind, entry, map, x, y, z, orientation, rotation }, ctx) => {
      const out = await ctx.call('worldAddSpawn', kind, entry, map, { x, y, z, orientation, rotation: rotation ?? null });
      return out.ok ? { ok: true, value: { guid: out.value.guid } } : out;
    },
  }),
  defineTool({
    name: 'move_spawn',
    title: 'Move or turn a spawn',
    description: `Moves or turns an existing spawn (by its guid; see find_spawns). ${UNITS} ${ROTATION_NOTE}`,
    input: { kind, guid, ...place },
    write: { kind: 'step', label: ({ kind, guid }: { kind: string; guid: number }) => `AI: move ${kind} ${guid}` },
    run: async ({ kind, guid, x, y, z, orientation, rotation }, ctx) => {
      const out = await ctx.call('worldMoveSpawn', kind, guid, { x, y, z, orientation, rotation: rotation ?? null });
      return out.ok ? { ok: true, value: { moved: { kind, guid } } } : out;
    },
  }),
  defineTool({
    name: 'set_route',
    title: 'Set a patrol route',
    description: `Sets the points of a patrol path (waypoint_data) by path id; use isNew for a path that does not exist yet, with a free id from allocate_ids or the NPC's guid times ten. ${UNITS}`,
    input: {
      pathId: z.number().int().min(1),
      points: z.array(z.object({ x: z.number(), y: z.number(), z: z.number() })).min(1).max(500),
      isNew: z.boolean().optional(),
    },
    write: { kind: 'step', label: ({ pathId }: { pathId: number }) => `AI: set route ${pathId}` },
    run: async ({ pathId, points, isNew }, ctx) => {
      const out = await ctx.call('worldSetRoute', pathId, points.map((p) => ({ ...p, rest: {} })), isNew === undefined ? undefined : { isNew });
      return out.ok ? { ok: true, value: { pathId, points: points.length } } : out;
    },
  }),
  defineTool({
    name: 'set_movement',
    title: "Set an NPC's movement",
    description: "Sets how an NPC spawn (by guid) moves: idle, wander within a radius in yards, or follow a path id (see set_route).",
    input: {
      guid,
      type: z.enum(['idle', 'wander', 'path']),
      wander: z.number().min(0).optional().describe('Wander radius in yards; only for type wander. Default 0.'),
      pathId: z.number().int().min(1).nullable().optional().describe('The path to follow; only for type path (see set_route). Default none.'),
    },
    write: { kind: 'step', label: ({ guid }: { guid: number }) => `AI: set movement of ${guid}` },
    run: async ({ guid, type, wander, pathId }, ctx) => {
      const out = await ctx.call('worldSetMovement', guid, { type, wander: wander ?? 0, pathId: pathId ?? null });
      return out.ok ? { ok: true, value: { guid, type } } : out;
    },
  }),
  defineTool({
    name: 'set_respawn',
    title: "Set a spawn's respawn time",
    description: 'Sets how long a spawn (by guid) takes to respawn after it dies or is looted, in seconds.',
    input: { kind, guid, seconds: z.number().int().min(0) },
    write: { kind: 'step', label: ({ kind, guid }: { kind: string; guid: number }) => `AI: set respawn of ${kind} ${guid}` },
    run: async ({ kind, guid, seconds }, ctx) => {
      const out = await ctx.call('worldSetRespawn', kind, guid, seconds);
      return out.ok ? { ok: true, value: { kind, guid, seconds } } : out;
    },
  }),
  defineTool({
    name: 'revert_world_change',
    title: 'Take back a world change',
    description:
      "Takes one world edit back out of the project: a moved spawn ({kind:'spawn',spawnKind,guid}), a route ({kind:'route',pathId}), a movement ({kind:'movement',guid}), a respawn time ({kind:'respawn',spawnKind,guid}), a group ({kind:'group',id}) or spawn events ({kind:'spawnEvents',guid}). See world_changes.",
    input: {
      target: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('spawn'), spawnKind: kind, guid: z.number().int() }),
        z.object({ kind: z.literal('route'), pathId: z.number().int() }),
        z.object({ kind: z.literal('movement'), guid: z.number().int() }),
        z.object({ kind: z.literal('respawn'), spawnKind: kind, guid: z.number().int() }),
        z.object({ kind: z.literal('group'), id: z.number().int() }),
        z.object({ kind: z.literal('spawnEvents'), guid: z.number().int() }),
      ]),
    },
    write: { kind: 'step', label: () => 'AI: revert world change' },
    run: async ({ target }, ctx) => {
      const out = await ctx.call('worldRevert', target);
      return out.ok ? { ok: true, value: { reverted: target } } : out;
    },
  }),
];

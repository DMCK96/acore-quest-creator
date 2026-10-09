import { z } from 'zod';
import { defineTool } from '../tool';

const id = z.number().int();

/** Searches and names in the connected world database, and what stands where in the world. */
export const lookupTools = [
  defineTool({
    name: 'search_quests',
    title: 'Search quests',
    description: 'Quests whose title contains the text, or whose id it is: id, title and level. Use it to see what already exists before writing something new.',
    input: { text: z.string().max(200) },
    write: false,
    run: ({ text }, ctx) => ctx.call('searchQuests', text),
  }),
  defineTool({
    name: 'search_entities',
    title: 'Search items, NPCs, objects, quests and spells',
    description: 'Items, NPCs (creature), objects (gameobject), quests or spells whose name contains the text, or whose id it is.',
    input: { kind: z.enum(['item', 'creature', 'gameobject', 'quest', 'spell']), text: z.string().max(200) },
    write: false,
    run: ({ kind, text }, ctx) => ctx.call('searchEntities', kind, text),
  }),
  defineTool({
    name: 'lookup_names',
    title: 'Names of ids',
    description: 'The names of ids of one kind (an item, NPC, object, quest, spell, faction, zone, map or skill), as an object from id to name.',
    input: { kind: z.enum(['item', 'creature', 'gameobject', 'quest', 'spell', 'faction', 'zone', 'map', 'skill']), ids: z.array(id).max(500) },
    write: false,
    run: ({ kind, ids }, ctx) => ctx.call('lookupNames', kind, ids),
  }),
  defineTool({
    name: 'quests_of_npc',
    title: 'Quests an NPC starts and ends',
    description: 'The quests an NPC (by creature entry) starts and the quests it ends.',
    input: { entry: id },
    write: false,
    run: ({ entry }, ctx) => ctx.call('questsOfNpc', entry),
  }),
  defineTool({
    name: 'spell_facts',
    title: 'Spell facts',
    description: 'Names and facts of spells, from the server data folder when the connection has one; otherwise says why there are none.',
    input: { ids: z.array(id).max(500) },
    write: false,
    run: ({ ids }, ctx) => ctx.call('spellFacts', ids),
  }),
  defineTool({
    name: 'reward_tables',
    title: 'Quest reward tables',
    description: 'The experience and money a quest of this level rewards, one entry per reward index.',
    input: { level: z.number().int() },
    write: false,
    run: ({ level }, ctx) => ctx.call('rewardTables', level),
  }),
  defineTool({
    name: 'game_events',
    title: 'Game events',
    description: 'The game events in the database (holidays and the like) with their ids and descriptions.',
    input: {},
    write: false,
    run: (_args, ctx) => ctx.call('gameEvents'),
  }),
  defineTool({
    name: 'quest_pools',
    title: 'Quest pools',
    description: 'The quest pools (rotations) in the database: their quests, how many are offered each reset, and whether they are daily or weekly.',
    input: {},
    write: false,
    run: (_args, ctx) => ctx.call('questPools'),
  }),
  defineTool({
    name: 'view_spawns',
    title: 'Spawns in an area',
    description:
      'NPC and object spawns inside a box on one map. Coordinates are world yards (X north, Y west). Each kind is capped, so use a small box (a few hundred yards) around the place you care about.',
    input: { map: id, minX: z.number(), maxX: z.number(), minY: z.number(), maxY: z.number() },
    write: false,
    run: ({ map, minX, maxX, minY, maxY }, ctx) => ctx.call('viewSpawns', map, { minX, maxX, minY, maxY }),
  }),
  defineTool({
    name: 'find_spawns',
    title: 'Where an NPC or object stands',
    description: 'Every spawn of one NPC (creature) or object (gameobject) entry, with its map and position, up to a few hundred.',
    input: { kind: z.enum(['creature', 'gameobject']), entry: id },
    write: false,
    run: ({ kind, entry }, ctx) => ctx.call('findSpawns', kind, entry),
  }),
  defineTool({
    name: 'ground_height',
    title: 'Ground height',
    description: 'The terrain height (Z) at a map position in world yards, from the server data folder, or the reason there is none.',
    input: { map: id, x: z.number(), y: z.number() },
    write: false,
    run: ({ map, x, y }, ctx) => ctx.call('groundHeight', map, x, y),
  }),
  defineTool({
    name: 'world_changes',
    title: 'World changes in the project',
    description: 'Every edit the project makes to the world outside quests: moved and placed spawns, routes, movements, respawn times and spawn groups.',
    input: {},
    write: false,
    run: (_args, ctx) => ctx.call('worldChanges'),
  }),
];

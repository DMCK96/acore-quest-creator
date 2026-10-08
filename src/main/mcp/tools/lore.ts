import { z } from 'zod';
import { defineTool } from '../tool';

const id = z.number().int();
const kind = z.enum(['creature', 'gameobject', 'item', 'quest']);

const COORDINATES =
  'Positions are world yards: X points north, Y points west, Z is up. An orientation is radians: 0 faces north and it grows toward west (π/2 west, π south, 3π/2 east).';

const WIKI_NOTE =
  'It reads warcraft.wiki.gg and is off unless the user turned it on in Settings (MCP / AI tab). The wiki covers every expansion while this server is at Wrath of the Lich King (3.3.5), so later events have not happened in its story yet; later content is welcome as inspiration for new content, but say where an idea comes from. The answer includes the page url and licence so it can be cited.';

/** Questions about what already exists in the world, and lookups on the Warcraft wiki. All read-only. */
export const loreTools = [
  defineTool({
    name: 'find_zone',
    title: 'Find a zone',
    description:
      'Turns a zone name (or quest category) into the id quests_in_zone takes: the zones and quest-log categories whose name contains the text, or the one with that id. Without the server data folder only ids work and zones are shown as "Zone <id>".',
    input: { text: z.string().min(1).max(200) },
    write: false,
    run: ({ text }, ctx) => ctx.call('searchEntities', 'questSort', text),
  }),
  defineTool({
    name: 'quests_in_zone',
    title: 'Quests in a zone',
    description:
      'The quests listed under a zone in the quest log (use find_zone for the id), by level, with the NPCs that start each. Filter by level range; the list is cut at the limit (default 50, at most 200) and says when it was. A quest that scales to the player has level -1 and is always included. Follow up with quest_summaries to read the stories.',
    input: { zone: id, minLevel: id.min(0).max(255).optional(), maxLevel: id.min(0).max(255).optional(), limit: id.min(1).max(200).optional() },
    write: false,
    run: ({ zone, minLevel, maxLevel, limit }, ctx) => {
      const filter = {
        ...(minLevel !== undefined ? { minLevel } : {}),
        ...(maxLevel !== undefined ? { maxLevel } : {}),
        ...(limit !== undefined ? { limit } : {}),
      };
      return ctx.call('questsInZone', zone, Object.keys(filter).length > 0 ? filter : undefined);
    },
  }),
  defineTool({
    name: 'quest_summaries',
    title: 'Read quests',
    description:
      'Reads up to 25 quests from the world database with their full text (objectives, details, reward and completion text, each cut at 1500 characters), what they ask for and give, who starts and ends them, and their chain links, WITHOUT importing them into the project (get_quest imports). Use it to learn the tone and facts of existing quests before writing new ones.',
    input: { questIds: z.array(id.min(1)).min(1).max(25) },
    write: false,
    run: ({ questIds }, ctx) => ctx.call('questSummaries', questIds),
  }),
  defineTool({
    name: 'area_overview',
    title: 'What is around a point',
    description:
      `The NPCs and objects inside a circle on a map, with what each does (roles such as vendor, innkeeper), its level, faction, the quests it starts and ends, what vendors sell and what NPCs drop, plus the quests and factions involved. Every spawn lists its position, offset and distance from your point, \`orientation\` (the radians add_spawn takes), \`facing\` (a compass word) and, for objects, the raw \`rotation\` quaternion, so you can place something beside it and match the way it faces. To face a spawn toward a point use orientation = atan2(targetY − y, targetX − x). An object whose rotation is all zeros stands upright facing north. ${COORDINATES} The radius defaults to 100 yards and is at most 500; lists are capped and \`truncated\` says which were cut, \`missing\` names tables this database lacks.`,
    input: { map: id.min(0), x: z.number(), y: z.number(), radius: z.number().positive().max(500).optional() },
    write: false,
    run: ({ map, x, y, radius }, ctx) => ctx.call('areaOverview', map, x, y, radius ?? 100),
  }),
  defineTool({
    name: 'check_names',
    title: 'Check names for clashes',
    description:
      'For each name, what already has it (ignoring case) or one like it, in the world database and in the project: NPCs (creature), objects (gameobject), items or quests. Use it before choosing a name for new content.',
    input: { kind, names: z.array(z.string().max(100)).min(1).max(25) },
    write: false,
    run: ({ kind, names }, ctx) => ctx.call('checkNames', kind, names),
  }),
  defineTool({
    name: 'check_ids',
    title: 'Check ids for clashes',
    description: 'For each id, whether the world database and the project already have an NPC (creature), object (gameobject), item or quest with it, and what it is called. Use it before using an id for new content (allocate_ids hands out free ones).',
    input: { kind, ids: z.array(id.min(1)).min(1).max(100) },
    write: false,
    run: ({ kind, ids }, ctx) => ctx.call('checkIds', kind, ids),
  }),
  defineTool({
    name: 'wiki_search',
    title: 'Search the Warcraft wiki',
    description: `Searches warcraft.wiki.gg for pages about a person, place, creature or event: titles, a plain-text snippet and the page url (default 5, at most 10). ${WIKI_NOTE}`,
    input: { text: z.string().min(1).max(200), limit: id.min(1).max(10).optional() },
    write: false,
    run: ({ text, limit }, ctx) => ctx.call('wikiSearch', text, limit),
  }),
  defineTool({
    name: 'wiki_page',
    title: 'Read a Warcraft wiki page',
    description: `Reads a warcraft.wiki.gg page: its intro and its list of section headings; name one of those headings in \`section\` to read that section (sub-sections included). Redirects are followed. ${WIKI_NOTE}`,
    input: { title: z.string().min(1).max(200), section: z.string().min(1).max(200).optional() },
    write: false,
    run: ({ title, section }, ctx) => ctx.call('wikiPage', title, section),
  }),
];

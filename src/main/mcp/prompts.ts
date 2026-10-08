import { z } from 'zod';

/**
 * Ready-made workflows an MCP client offers as slash commands. Each is a short plain list of steps
 * that names real tools (a test checks that every tool named exists), opening with the rules the
 * assistant always works by.
 */

export interface PromptDef {
  name: string;
  title: string;
  description: string;
  /** MCP prompt arguments are strings */
  args: z.ZodRawShape;
  text(args: Record<string, unknown>): string;
}

export const PROMPT_RULES =
  'Work in the user\'s open project. Every change you make is one undoable step labelled "AI:". You never write to the world database. Ask before exporting. If an idea borrows from a later expansion, say where it comes from.';

const str = (args: Record<string, unknown>, key: string): string => String(args[key] ?? '').trim();

const questChain: PromptDef = {
  name: 'quest_chain',
  title: 'Build a lore-accurate quest chain',
  description: 'Research a zone, then draft a quest chain that fits it: quests, NPCs placed beside their neighbours, scenes, and checks.',
  args: {
    zone: z.string().describe('The zone, such as Elwynn Forest.'),
    minLevel: z.string().describe('The lowest level the chain is for.'),
    maxLevel: z.string().describe('The highest level the chain is for.'),
    theme: z.string().optional().describe('An idea or tone for the chain.'),
  },
  text: (a) =>
    [
      PROMPT_RULES,
      '',
      `Build a quest chain in ${str(a, 'zone')} for levels ${str(a, 'minLevel')} to ${str(a, 'maxLevel')}${str(a, 'theme') ? `, themed around: ${str(a, 'theme')}` : ''}. Make it fit the world as it already is.`,
      '',
      `1. Call \`find_zone\` to get the id of ${str(a, 'zone')}.`,
      '2. Call `quests_in_zone` with that id and the level range to see what already exists, then `quest_summaries` on a few of them to learn the tone, the NPCs and the story so far.',
      '3. Call `area_overview` around the place the chain starts and the places it visits, to see the NPCs and objects there and which way they face.',
      '4. If wiki lookups are on, call `wiki_search` and read the best pages for the lore of the place; if the tool says wiki lookups are off, carry on without it. This server is at Wrath of the Lich King, so later events have not happened yet; later content is welcome as inspiration, but say where an idea comes from.',
      '5. Before naming anything, call `check_names` and `check_ids` so nothing clashes with what exists.',
      '6. Call `new_quest` for each quest and `set_quest_fields` to fill it in; call `describe_quest_fields` first if you are unsure what a field takes.',
      '7. Place the NPCs the chain needs. For an NPC that already exists use `add_spawn`; for a new one call `new_entity` (a model and the right faction), then give it a spawn with `upsert_entity`, taking the spawn guid from `allocate_ids`. Copy `orientation` from a neighbour (or compute it) so they face the way their neighbours do.',
      '8. Add scenes for the key moments with `set_scene` (call `describe_authoring` with model scene first).',
      '9. Call `validate_quest` for each quest and fix every error it reports.',
      '10. Call `preview_changes` for a quest, then summarise what you made, and ask before exporting.',
    ].join('\n'),
};

const legendaryItem: PromptDef = {
  name: 'legendary_item',
  title: 'Brainstorm and build a legendary item and its quest chain',
  description: 'Turn an idea for a legendary item into an outline first, then build the item, its guardian and the chain that leads to it.',
  args: { idea: z.string().describe('The idea for the item, in a sentence or two.') },
  text: (a) =>
    [
      PROMPT_RULES,
      '',
      `The user has an idea for a legendary item and a quest chain to get it: ${str(a, 'idea')}`,
      '',
      '1. Brainstorm first. If wiki lookups are on, check the lore with `wiki_search` (if the tool says they are off, use what you know). Then propose an outline of the item, the encounter that guards it and the chain that leads to it, and ask the user to confirm or change it before building anything.',
      '2. Once confirmed, call `check_names` for the item, the guardian and the quests so nothing clashes.',
      '3. Call `new_entity` for the item (call `describe_authoring` with model item first) and set its quality, level, stats and effects.',
      '4. Call `new_entity` for the guardian NPC with a model and a hostile faction such as 14 (a new NPC is friendly and never fights), then `set_npc_fight` for its encounter (model fight) and `set_loot` so it drops the item, then give it a spawn with `upsert_entity`, taking the spawn guid from `allocate_ids`.',
      '5. Call `new_quest` and `set_quest_fields` for each quest of the chain that leads to the guardian.',
      '6. Call `validate_quest` for each quest and `check_project_entities` for the item and the guardian, and fix every error.',
      '7. Summarise what you made and ask before exporting.',
    ].join('\n'),
};

const populatePlace: PromptDef = {
  name: 'populate_place',
  title: 'Add NPCs or objects that fit a place',
  description: 'Read what stands around a point, then add NPCs or objects that fit and face the way their neighbours do.',
  args: {
    map: z.string().describe('The map id (0 is Eastern Kingdoms).'),
    x: z.string().describe('World X (north) in yards.'),
    y: z.string().describe('World Y (west) in yards.'),
    what: z.string().describe('What to add, in a sentence.'),
  },
  text: (a) =>
    [
      PROMPT_RULES,
      '',
      `Add ${str(a, 'what')} around map ${str(a, 'map')}, x ${str(a, 'x')}, y ${str(a, 'y')}, so it fits what is already there.`,
      '',
      '1. Call `area_overview` at that point to see the NPCs, objects, roles and factions there, and how they are placed.',
      '2. Call `check_names` for the names you plan to use.',
      '3. Call `new_entity` for each new NPC or object (call `describe_authoring` first) and give it a model and the right faction.',
      '4. Place each new one by adding a spawn to it with `upsert_entity`, taking the spawn guid from `allocate_ids` (kind `creatureSpawn` or `gameobjectSpawn`); use `add_spawn` only for more spawns of an existing database NPC or object. Copy `orientation` (and `rotation` for objects) from a neighbour, or compute it with the formula in `area_overview`\'s description, so new spawns face the way their neighbours do.',
      '5. Call `check_project_entities`, fix every error, then summarise what you added and ask before exporting.',
    ].join('\n'),
};

export const allPrompts: readonly PromptDef[] = [questChain, legendaryItem, populatePlace];

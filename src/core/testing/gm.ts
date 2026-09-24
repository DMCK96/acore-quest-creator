/**
 * The GM commands an author types to try a quest after applying it to a dev server: which data to
 * reload, what only a restart picks up, where to go, and how to take and finish the quest. Command
 * names are the fork's own, from `cs_reload.cpp`, `cs_go.cpp` and `cs_quest.cpp`.
 */

export interface GmCommand {
  command: string;
  label: string;
}

export interface GmRestart {
  reason: string;
}

export interface TestCommands {
  reload: GmCommand[];
  restart: GmRestart[];
  go: GmCommand[];
  quest: GmCommand[];
}

export interface GmInput {
  questId: number;
  /** Every table the quest's patch writes to. */
  tables: ReadonlySet<string>;
  /** `creature_template` entries the patch inserts or changes. */
  creatureTemplates: readonly number[];
  hasStarter: boolean;
  /** Where the quest's new NPCs and objects stand. */
  spawns: readonly { name: string; map: number; x: number; y: number; z: number }[];
  newObjectTemplates: boolean;
  escorts: boolean;
}

const QUEST_TABLES = [
  'quest_template', 'quest_template_addon', 'quest_details', 'quest_request_items', 'quest_offer_reward', 'quest_poi', 'quest_poi_points',
  'creature_queststarter', 'creature_questender', 'gameobject_queststarter', 'gameobject_questender',
];

/** Tables whose rows one reload command picks up, in the order the commands are listed. */
const RELOADS: readonly { tables: readonly string[]; command: string; label: string }[] = [
  { tables: QUEST_TABLES, command: '.reload all quest', label: 'Quest text, rewards and givers' },
  { tables: ['smart_scripts'], command: '.reload smart_scripts', label: 'Scripts' },
  { tables: ['waypoint_data'], command: '.reload waypoint_data', label: 'Patrol routes' },
  { tables: ['creature_text'], command: '.reload creature_text', label: 'What NPCs say' },
  { tables: ['conditions'], command: '.reload conditions', label: 'Conditions' },
  { tables: ['gossip_menu', 'gossip_menu_option', 'npc_text'], command: '.reload all gossips', label: 'Talk options' },
  { tables: ['page_text'], command: '.reload page_text', label: 'Pages' },
  { tables: ['areatrigger', 'areatrigger_scripts', 'areatrigger_involvedrelation'], command: '.reload all area', label: 'Area triggers' },
];

export function gmCommands(input: GmInput): TestCommands {
  const { questId, tables } = input;
  const reload: GmCommand[] = RELOADS.filter((r) => r.tables.some((t) => tables.has(t))).map(({ command, label }) => ({ command, label }));
  for (const entry of [...new Set(input.creatureTemplates)].sort((a, b) => a - b)) {
    reload.push({ command: `.reload creature_template ${entry}`, label: `NPC ${entry}` });
  }

  const restart: GmRestart[] = [];
  if (tables.has('creature') || tables.has('gameobject')) {
    restart.push({ reason: 'New spawns appear after a server restart: the server loads spawns when it starts.' });
  }
  if (tables.has('creature_addon')) {
    restart.push({ reason: 'A new or changed patrol starts after a server restart: the server reads which spawn walks which route when it starts.' });
  }
  if (input.newObjectTemplates) {
    restart.push({ reason: 'New objects appear after a server restart: object templates cannot be reloaded.' });
  }
  if (input.escorts || tables.has('waypoints')) {
    restart.push({ reason: 'Escort paths change after a server restart: SmartAI reads them when the server starts.' });
  }

  const go: GmCommand[] = [];
  if (input.hasStarter) go.push({ command: `.go quest starter ${questId}`, label: 'The quest giver' });
  for (const s of input.spawns) go.push({ command: `.go xyz ${s.x} ${s.y} ${s.z} ${s.map}`, label: s.name });

  const quest: GmCommand[] = [
    { command: `.quest add ${questId}`, label: 'Take the quest' },
    { command: `.quest complete ${questId}`, label: 'Complete its objectives' },
    { command: `.quest reward ${questId}`, label: 'Hand it in' },
    { command: `.quest remove ${questId}`, label: 'Drop it' },
  ];
  return { reload, restart, go, quest };
}

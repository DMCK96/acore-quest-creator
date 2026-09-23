import type { FieldDef, ListFieldDef, ScalarFieldDef, ScalarType, TableDef } from '../types';

const TABLE = 'quest_template';

const scalar = (def: Omit<ScalarFieldDef, 'shape' | 'id' | 'table'>): ScalarFieldDef => ({
  shape: 'scalar',
  id: `${TABLE}.${def.column}`,
  table: TABLE,
  ...def,
});

const list = (def: Omit<ListFieldDef, 'shape' | 'id' | 'table'> & { name: string }): ListFieldDef => {
  const { name, ...rest } = def;
  return { shape: 'list', id: `${TABLE}.${name}`, table: TABLE, ...rest };
};

/**
 * `QuestFlags` from the fork's `src/server/game/Quests/QuestDef.h`. Bits the 3.3.5 core never
 * reads are kept, with the label saying so, because the value must still round-trip.
 */
const QUEST_FLAGS: ScalarType = {
  kind: 'flags',
  flags: [
    { bit: 0x00000001, label: 'Failed when the player dies' },
    { bit: 0x00000002, label: 'Party members are asked to accept too (unused in 3.3.5)' },
    { bit: 0x00000004, label: 'Exploration quest (unused in 3.3.5)' },
    { bit: 0x00000008, label: 'Can be shared with the party' },
    { bit: 0x00000010, label: 'Has a condition (unused in 3.3.5)' },
    { bit: 0x00000020, label: 'Hide the reward map marker (unused in 3.3.5)' },
    { bit: 0x00000040, label: 'Raid quest (unused in 3.3.5)' },
    { bit: 0x00000080, label: 'Burning Crusade only (unused in 3.3.5)' },
    { bit: 0x00000100, label: 'No bonus gold instead of XP at max level' },
    { bit: 0x00000200, label: 'Hide the rewards until the quest is handed in' },
    { bit: 0x00000400, label: 'Tracking quest: rewarded instantly, never shown in the quest log' },
    { bit: 0x00000800, label: 'Deprecated reputation (unused in 3.3.5)' },
    { bit: 0x00001000, label: 'Daily quest' },
    { bit: 0x00002000, label: 'Forces PvP while the quest is in the log' },
    { bit: 0x00004000, label: 'Not normally available' },
    { bit: 0x00008000, label: 'Weekly quest' },
    { bit: 0x00010000, label: 'Completes as soon as it is accepted' },
    { bit: 0x00020000, label: 'Show the usable quest item in the tracker' },
    { bit: 0x00040000, label: 'Use the objective text as the completion text' },
    { bit: 0x00080000, label: 'Client-side auto-accept (no 3.3.5 quest uses this)' },
  ],
};

/** `QuestTypes` in the fork's `SharedDefines.h`; the values come from QuestInfo.dbc. */
const QUEST_INFO: ScalarType = {
  kind: 'enum',
  options: [
    { value: 0, label: 'Normal' },
    { value: 1, label: 'Elite' },
    { value: 21, label: 'Life' },
    { value: 41, label: 'PvP' },
    { value: 62, label: 'Raid' },
    { value: 81, label: 'Dungeon' },
    { value: 82, label: 'World event' },
    { value: 83, label: 'Legendary' },
    { value: 84, label: 'Escort' },
    { value: 85, label: 'Heroic' },
    { value: 88, label: 'Raid (10 player)' },
    { value: 89, label: 'Raid (25 player)' },
  ],
};

/** The old `Method` column: the core only accepts 0, 1 or 2. */
const QUEST_METHOD: ScalarType = {
  kind: 'enum',
  options: [
    { value: 0, label: 'Instant: no objectives or details are shown' },
    { value: 1, label: 'Normal (legacy value)' },
    { value: 2, label: 'Normal' },
  ],
};

const scalars: ScalarFieldDef[] = [
  scalar({
    column: 'ID',
    type: { kind: 'int', min: 0 },
    label: 'ID',
    help: 'The number that identifies this quest everywhere else in the database. It cannot be changed after the quest exists.',
    group: 'identity',
    readOnlyUi: true,
  }),
  scalar({
    column: 'QuestType',
    type: QUEST_METHOD,
    label: 'Quest handling',
    help: 'How the client treats the quest. Almost every quest uses 2. Use 0 only for a quest that has no objectives and completes the moment it is taken.',
    group: 'identity',
  }),
  scalar({
    column: 'QuestLevel',
    type: { kind: 'int' },
    label: 'Quest level',
    help: 'The level the quest is balanced for. It drives the experience and money rewards and the colour of the quest title. -1 means "the same level as the player".',
    group: 'identity',
  }),
  scalar({
    column: 'MinLevel',
    type: { kind: 'int', min: 0 },
    label: 'Minimum player level',
    help: 'The lowest level a player can be and still be offered the quest.',
    group: 'identity',
  }),
  scalar({
    column: 'QuestSortID',
    type: { kind: 'int' },
    label: 'Quest log category',
    help: 'Where the quest is filed in the quest log. A positive value is a zone ID from AreaTable.dbc. A negative value is a category from QuestSort.dbc with the sign flipped, for example -22 for Seasonal or -81 for Warrior.',
    group: 'identity',
    control: 'questSort',
  }),
  scalar({
    column: 'QuestInfoID',
    type: QUEST_INFO,
    label: 'Quest type tag',
    help: 'The tag shown next to the quest title, such as Elite, Dungeon or PvP. Normal quests use 0.',
    group: 'identity',
  }),
  scalar({
    column: 'SuggestedGroupNum',
    type: { kind: 'int', min: 0 },
    label: 'Suggested players',
    help: 'The party size the quest suggests. 0 hides the suggestion.',
    group: 'identity',
  }),
  scalar({
    column: 'AllowableRaces',
    type: { kind: 'int', min: 0 },
    label: 'Races that can take this quest',
    help: 'A bitmask of the races allowed to take the quest. 0 means every race.',
    group: 'identity',
    control: 'raceMask',
  }),
  scalar({
    column: 'VerifiedBuild',
    type: { kind: 'int' },
    label: 'Verified build',
    help: 'Bookkeeping left by the data sniffer: the client build this row was last checked against. The server ignores it.',
    group: 'identity',
    advanced: true,
  }),

  scalar({
    column: 'LogTitle',
    type: { kind: 'string' },
    label: 'Quest title',
    help: 'The name of the quest, as it appears above the NPC and in the quest log.',
    group: 'story',
  }),
  scalar({
    column: 'QuestDescription',
    type: { kind: 'text' },
    label: 'Story text',
    help: 'What the quest giver says when offering the quest. Tokens such as $N (player name) and $B (line break) work here.',
    group: 'story',
  }),
  scalar({
    column: 'LogDescription',
    type: { kind: 'text' },
    label: 'Objectives text',
    help: 'The one-line summary of what to do, shown under the objectives in the quest log.',
    group: 'story',
  }),
  scalar({
    column: 'QuestCompletionLog',
    type: { kind: 'text' },
    label: 'Log text when complete',
    help: 'The line shown in the quest log once every objective is done, telling the player where to go back to.',
    group: 'story',
  }),
  scalar({
    column: 'AreaDescription',
    type: { kind: 'text' },
    label: 'Area description',
    help: 'Not used by the 3.3.5 client. Kept so the row round-trips unchanged.',
    group: 'story',
    advanced: true,
  }),

  scalar({
    column: 'RequiredPlayerKills',
    type: { kind: 'int', min: 0 },
    label: 'Enemy players to kill',
    help: 'How many enemy players must be killed to complete the quest. 0 for a normal PvE quest.',
    group: 'objectives',
  }),
  scalar({
    column: 'TimeAllowed',
    type: { kind: 'int', min: 0 },
    label: 'Time limit (seconds)',
    help: 'How long the player has, in seconds, once the quest is accepted. 0 means no timer.',
    group: 'objectives',
  }),
  scalar({
    column: 'Unknown0',
    type: { kind: 'int' },
    label: 'Unknown column',
    help: 'A column of the client quest record whose purpose is not known. The server never reads it. Kept so the row round-trips unchanged.',
    group: 'objectives',
    advanced: true,
  }),

  scalar({
    column: 'RewardXPDifficulty',
    type: { kind: 'int', min: 0 },
    label: 'XP reward',
    help: 'Picks which experience column of QuestXP.dbc to pay at the quest level, so the reward scales with the level rather than being a fixed number. 0 gives no experience.',
    group: 'rewards',
    control: 'xpDifficulty',
  }),
  scalar({
    column: 'RewardMoney',
    type: { kind: 'money' },
    label: 'Fixed money reward',
    help: 'Money given on completion, in copper. A negative value takes money from the player instead.',
    group: 'rewards',
  }),
  scalar({
    column: 'RewardMoneyDifficulty',
    type: { kind: 'int', min: 0 },
    label: 'Money reward tier',
    help: 'Names the per-level money tier the reward was authored from, which lets the payout follow the level the quest is played at. Blizzlike data in this fork stores the client\'s "money at max level" here instead, and the server falls back to matching the tier from the money reward itself.',
    group: 'rewards',
    control: 'moneyDifficulty',
  }),
  scalar({
    column: 'RewardDisplaySpell',
    type: { kind: 'idRef', target: 'spell' },
    label: 'Spell shown as a reward',
    help: 'The spell displayed in the reward panel. It is shown to the player but not cast by the server. 0 for none.',
    group: 'rewards',
  }),
  scalar({
    column: 'RewardSpell',
    type: { kind: 'idRef', target: 'spell' },
    label: 'Spell cast on completion',
    help: 'The spell the quest giver actually casts on the player when the quest is handed in. 0 for none.',
    group: 'rewards',
  }),
  scalar({
    column: 'RewardHonor',
    type: { kind: 'int' },
    label: 'Honor reward',
    help: 'Honor points given on completion. 0 for none.',
    group: 'rewards',
  }),
  scalar({
    column: 'RewardKillHonor',
    type: { kind: 'float' },
    label: 'Honor multiplier',
    help: 'Multiplies the honor reward. Most quests leave this at 0.',
    group: 'rewards',
  }),
  scalar({
    column: 'RewardTitle',
    type: { kind: 'idRef', target: 'title' },
    label: 'Title reward',
    help: 'A player title from CharTitles.dbc given on completion. 0 for none.',
    group: 'rewards',
  }),
  scalar({
    column: 'RewardTalents',
    type: { kind: 'int', min: 0 },
    label: 'Extra talent points',
    help: 'Bonus talent points given on completion. Used by the death knight starting chain. 0 for none.',
    group: 'rewards',
  }),
  scalar({
    column: 'RewardArenaPoints',
    type: { kind: 'int', min: 0 },
    label: 'Arena points reward',
    help: 'Arena points given on completion. 0 for none.',
    group: 'rewards',
  }),

  scalar({
    column: 'StartItem',
    type: { kind: 'idRef', target: 'item' },
    label: 'Item given on accept',
    help: 'An item put in the player\'s bags when they accept the quest, such as a letter to deliver. It does not start the quest: an item that begins a quest is set on the item itself. 0 for none.',
    group: 'availability',
    linksItems: true,
  }),
  scalar({
    column: 'Flags',
    type: QUEST_FLAGS,
    label: 'Quest flags',
    help: 'Switches that change how the quest behaves: daily, weekly, shareable, PvP and so on. Stored as one number with one bit per switch.',
    group: 'availability',
  }),
  scalar({
    column: 'RewardNextQuest',
    type: { kind: 'idRef', target: 'quest' },
    label: 'Quest offered straight after',
    help: 'The quest the same NPC offers immediately after this one is handed in. This is only the hand-in pop-up; it does not by itself make the next quest require this one. 0 for none.',
    group: 'availability',
  }),

  scalar({
    column: 'POIContinent',
    type: { kind: 'idRef', target: 'map' },
    label: 'Map for the quest marker',
    help: 'The map ID the objective marker sits on, for example 0 for Eastern Kingdoms or 1 for Kalimdor.',
    group: 'map',
  }),
  scalar({
    column: 'POIx',
    type: { kind: 'float' },
    label: 'Marker X',
    help: 'World X coordinate of the objective marker on the map.',
    group: 'map',
  }),
  scalar({
    column: 'POIy',
    type: { kind: 'float' },
    label: 'Marker Y',
    help: 'World Y coordinate of the objective marker on the map.',
    group: 'map',
  }),
  scalar({
    column: 'POIPriority',
    type: { kind: 'int', min: 0 },
    label: 'Marker priority',
    help: 'Which marker the client prefers when a quest has more than one. Usually 0.',
    group: 'map',
  }),
];

const lists: ListFieldDef[] = [
  list({
    name: 'RequiredNpcOrGo',
    slots: 4,
    members: [
      {
        name: 'target',
        columnTemplate: 'RequiredNpcOrGo{n}',
        type: { kind: 'creatureOrGo' },
        label: 'Creature or object',
      },
      {
        name: 'count',
        columnTemplate: 'RequiredNpcOrGoCount{n}',
        type: { kind: 'int', min: 0 },
        label: 'How many',
      },
    ],
    label: 'Kill or use',
    help: 'Creatures to kill or objects to use. The stored value is positive for a creature ID and negative for a gameobject ID.',
    group: 'objectives',
  }),
  list({
    name: 'RequiredItems',
    slots: 6,
    members: [
      { name: 'item', columnTemplate: 'RequiredItemId{n}', type: { kind: 'idRef', target: 'item' }, label: 'Item' },
      { name: 'count', columnTemplate: 'RequiredItemCount{n}', type: { kind: 'int', min: 0 }, label: 'How many' },
    ],
    label: 'Items to collect',
    help: 'Items the player must hand in. They are taken from the bags when the quest is turned in.',
    group: 'objectives',
    linksItems: ['item'],
  }),
  list({
    name: 'ObjectiveText',
    slots: 4,
    members: [
      { name: 'text', columnTemplate: 'ObjectiveText{n}', type: { kind: 'string' }, label: 'Line' },
    ],
    label: 'Objective wording',
    help: 'Replaces the wording of the matching kill-or-use objective in the quest log, for objectives such as "Speak to" that are not really kills.',
    group: 'objectives',
  }),
  list({
    name: 'ItemDrops',
    slots: 4,
    members: [
      { name: 'item', columnTemplate: 'ItemDrop{n}', type: { kind: 'idRef', target: 'item' }, label: 'Item' },
      {
        name: 'quantity',
        columnTemplate: 'ItemDropQuantity{n}',
        type: { kind: 'int', min: 0 },
        label: 'How many',
      },
    ],
    label: 'Quest-only drops',
    help: 'Items that only drop while the quest is in the log, and that are removed from the bags when it ends.',
    group: 'objectives',
    linksItems: ['item'],
  }),

  list({
    name: 'RewardItems',
    slots: 4,
    members: [
      { name: 'item', columnTemplate: 'RewardItem{n}', type: { kind: 'idRef', target: 'item' }, label: 'Item' },
      { name: 'amount', columnTemplate: 'RewardAmount{n}', type: { kind: 'int', min: 0 }, label: 'How many' },
    ],
    label: 'Items always given',
    help: 'Items every player receives on completion, on top of any choice reward.',
    group: 'rewards',
  }),
  list({
    name: 'RewardChoiceItems',
    slots: 6,
    members: [
      {
        name: 'item',
        columnTemplate: 'RewardChoiceItemID{n}',
        type: { kind: 'idRef', target: 'item' },
        label: 'Item',
      },
      {
        name: 'quantity',
        columnTemplate: 'RewardChoiceItemQuantity{n}',
        type: { kind: 'int', min: 0 },
        label: 'How many',
      },
    ],
    label: 'Items to choose from',
    help: 'The player picks exactly one of these on completion.',
    group: 'rewards',
  }),
  list({
    name: 'RewardFactions',
    slots: 5,
    members: [
      {
        name: 'faction',
        columnTemplate: 'RewardFactionID{n}',
        type: { kind: 'idRef', target: 'faction' },
        label: 'Faction',
      },
      { name: 'value', columnTemplate: 'RewardFactionValue{n}', type: { kind: 'int' }, label: 'Reputation change' },
      { name: 'override', columnTemplate: 'RewardFactionOverride{n}', type: { kind: 'int' }, label: 'Exact amount' },
    ],
    label: 'Reputation rewards',
    help: 'Reputation given or taken on completion. Leave the exact amount at 0 to use the standard reputation table; set it to spend a flat amount instead, in tenths of a reputation point.',
    group: 'rewards',
  }),
  list({
    name: 'RequiredFactions',
    slots: 2,
    members: [
      {
        name: 'faction',
        columnTemplate: 'RequiredFactionId{n}',
        type: { kind: 'idRef', target: 'faction' },
        label: 'Faction',
      },
      {
        name: 'value',
        columnTemplate: 'RequiredFactionValue{n}',
        type: { kind: 'int' },
        label: 'Reputation needed',
      },
    ],
    label: 'Reputation required',
    help: 'Reputation the player must already have with a faction before the quest is offered.',
    group: 'availability',
  }),
];

export const questTemplateTable: TableDef = {
  table: TABLE,
  role: 'owned',
  cardinality: 'one',
  keyColumns: ['ID'],
  alwaysEmit: true,
  where: (questId) => ({ ID: String(questId) }),
};

export const questTemplateFields: readonly FieldDef[] = [...scalars, ...lists];

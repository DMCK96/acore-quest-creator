import type { FieldDef, RowSetFieldDef, TableDef } from '../types';

/**
 * The many-row tables a quest owns: who offers it, who takes it back, which area trigger completes
 * it, which game events publish it and which pool it belongs to.
 *
 * Every one of them is keyed by the quest, so the field id is simply the table name: a table holds
 * exactly one rowset field. The quest column itself is `questColumn`, never part of the decoded
 * value, so a quest being copied or created picks up its own ID on export.
 */

const rowset = (def: Omit<RowSetFieldDef, 'shape' | 'id' | 'group'> & { table: string }): RowSetFieldDef => ({
  shape: 'rowset',
  id: def.table,
  group: 'availability',
  ...def,
});

const creatureRef = { kind: 'idRef', target: 'creature' } as const;
const gameobjectRef = { kind: 'idRef', target: 'gameobject' } as const;

/** `id` + `quest` tables share one shape; only the target, the label and the control differ. */
const questGiverTable = (table: string, keyColumns: readonly string[]): TableDef => ({
  table,
  role: 'owned',
  cardinality: 'many',
  keyColumns,
  where: (questId) => ({ quest: String(questId) }),
});

export const creatureQueststarterField = rowset({
  table: 'creature_queststarter',
  columns: [{ name: 'id', type: creatureRef, label: 'NPC' }],
  questColumn: 'quest',
  label: 'Quest givers',
  help: 'Creatures that offer this quest. The server also needs the quest giver flag on each of them.',
  control: 'starters',
});

export const creatureQuestenderField = rowset({
  table: 'creature_questender',
  columns: [{ name: 'id', type: creatureRef, label: 'NPC' }],
  questColumn: 'quest',
  label: 'Quest finishers',
  help: 'Creatures that take this quest back and hand out the reward.',
  control: 'enders',
});

export const gameobjectQueststarterField = rowset({
  table: 'gameobject_queststarter',
  columns: [{ name: 'id', type: gameobjectRef, label: 'Object' }],
  questColumn: 'quest',
  label: 'Object quest givers',
  help: 'Game objects that offer this quest, for instance a notice board.',
  control: 'starters',
});

export const gameobjectQuestenderField = rowset({
  table: 'gameobject_questender',
  columns: [{ name: 'id', type: gameobjectRef, label: 'Object' }],
  questColumn: 'quest',
  label: 'Object quest finishers',
  help: 'Game objects that take this quest back and hand out the reward.',
  control: 'enders',
});

export const areatriggerInvolvedrelationField = rowset({
  table: 'areatrigger_involvedrelation',
  columns: [{ name: 'id', type: { kind: 'idRef', target: 'areatrigger' }, label: 'Area trigger' }],
  questColumn: 'quest',
  label: 'Area triggers that complete the quest',
  help: 'Walking into one of these completes the quest. Each one can only ever serve one quest.',
  control: 'enders',
});

export const gameEventCreatureQuestField = rowset({
  table: 'game_event_creature_quest',
  columns: [
    { name: 'eventEntry', type: { kind: 'int', min: 0 }, label: 'Game event' },
    { name: 'id', type: creatureRef, label: 'NPC' },
  ],
  questColumn: 'quest',
  label: 'Creature quest givers during a game event',
  help: 'The creature only offers this quest while the named game event is running.',
});

export const gameEventGameobjectQuestField = rowset({
  table: 'game_event_gameobject_quest',
  columns: [
    { name: 'eventEntry', type: { kind: 'int', min: 0 }, label: 'Game event' },
    { name: 'id', type: gameobjectRef, label: 'Object' },
  ],
  questColumn: 'quest',
  label: 'Object quest givers during a game event',
  help: 'The game object only offers this quest while the named game event is running.',
});

export const poolQuestField = rowset({
  table: 'pool_quest',
  columns: [
    { name: 'pool_entry', type: { kind: 'int', min: 0 }, label: 'Pool' },
    { name: 'description', type: { kind: 'string' }, label: 'Pool description' },
  ],
  questColumn: 'entry',
  label: 'Quest pool',
  help: 'Pooled quests are rotated by the server, so only some of the pool are offered at a time.',
});

export const relationTables: readonly TableDef[] = [
  questGiverTable('creature_queststarter', ['id', 'quest']),
  questGiverTable('creature_questender', ['id', 'quest']),
  questGiverTable('gameobject_queststarter', ['id', 'quest']),
  questGiverTable('gameobject_questender', ['id', 'quest']),
  // One area trigger serves at most one quest, so its primary key is the trigger alone.
  questGiverTable('areatrigger_involvedrelation', ['id']),
  questGiverTable('game_event_creature_quest', ['id', 'quest']),
  // The fork's primary key here carries the event too: one object can offer a quest in two events.
  questGiverTable('game_event_gameobject_quest', ['id', 'quest', 'eventEntry']),
  {
    table: 'pool_quest',
    role: 'owned',
    cardinality: 'many',
    keyColumns: ['entry'],
    where: (questId) => ({ entry: String(questId) }),
  },
];

export const relationFields: readonly FieldDef[] = [
  creatureQueststarterField,
  creatureQuestenderField,
  gameobjectQueststarterField,
  gameobjectQuestenderField,
  areatriggerInvolvedrelationField,
  gameEventCreatureQuestField,
  gameEventGameobjectQuestField,
  poolQuestField,
];

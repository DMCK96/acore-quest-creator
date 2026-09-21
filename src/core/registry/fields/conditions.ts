import type { FieldDef, RowSetColumn, RowSetFieldDef, TableDef } from '../types';

/**
 * The availability conditions of a quest: `conditions` rows whose source is
 * CONDITION_SOURCE_TYPE_QUEST_AVAILABLE (19) and whose source entry is the quest.
 *
 * The table's primary key is ten columns wide. Two of them are not editable: the source type is a
 * fixed column and the source entry is the quest column, so every row the editor adds is stamped
 * with both. All the others are editable columns, which is what keeps each added row uniquely keyed.
 */

/** CONDITION_SOURCE_TYPE_QUEST_AVAILABLE in ConditionMgr.h. */
const SOURCE_QUEST_AVAILABLE = '19';

/**
 * ConditionType in ConditionMgr.h. The gaps (50 to 100, 107 and up) are placeholders the server
 * rejects, but an unknown value stays a legal value, so the list only supplies names.
 */
const CONDITION_TYPES: readonly { value: number; label: string }[] = [
  { value: 0, label: 'Always true' },
  { value: 1, label: 'Has aura' },
  { value: 2, label: 'Has item' },
  { value: 3, label: 'Has item equipped' },
  { value: 4, label: 'In zone' },
  { value: 5, label: 'Reputation rank' },
  { value: 6, label: 'Team' },
  { value: 7, label: 'Skill' },
  { value: 8, label: 'Quest rewarded' },
  { value: 9, label: 'Quest taken' },
  { value: 10, label: 'Drunken state' },
  { value: 11, label: 'World state' },
  { value: 12, label: 'Game event active' },
  { value: 13, label: 'Instance info' },
  { value: 14, label: 'Quest not in log' },
  { value: 15, label: 'Class' },
  { value: 16, label: 'Race' },
  { value: 17, label: 'Achievement' },
  { value: 18, label: 'Title' },
  { value: 19, label: 'Spawn mask' },
  { value: 20, label: 'Gender' },
  { value: 21, label: 'Unit state' },
  { value: 22, label: 'On map' },
  { value: 23, label: 'In area' },
  { value: 24, label: 'Creature type' },
  { value: 25, label: 'Knows spell' },
  { value: 26, label: 'Phase mask' },
  { value: 27, label: 'Level' },
  { value: 28, label: 'Quest complete, not rewarded' },
  { value: 29, label: 'Near creature' },
  { value: 30, label: 'Near game object' },
  { value: 31, label: 'Object entry or GUID' },
  { value: 32, label: 'Object type mask' },
  { value: 33, label: 'Relation to target' },
  { value: 34, label: 'Reaction to target' },
  { value: 35, label: 'Distance to target' },
  { value: 36, label: 'Alive' },
  { value: 37, label: 'Health value' },
  { value: 38, label: 'Health percent' },
  { value: 39, label: 'Realm achievement' },
  { value: 40, label: 'In water' },
  { value: 41, label: 'Terrain swap (unused on 3.3.5a)' },
  { value: 42, label: 'Stand state' },
  { value: 43, label: 'Daily quest done' },
  { value: 44, label: 'Charmed' },
  { value: 45, label: 'Pet type' },
  { value: 46, label: 'On taxi' },
  { value: 47, label: 'Quest state' },
  { value: 48, label: 'Quest objective progress' },
  { value: 49, label: 'Difficulty' },
  { value: 101, label: 'Quest exclusive group satisfied' },
  { value: 102, label: 'Has aura type' },
  { value: 103, label: 'World script' },
  { value: 104, label: 'AI data' },
  { value: 105, label: 'Queued for random dungeon' },
  { value: 106, label: 'In combat' },
];

const int = (name: string, label: string): RowSetColumn => ({ name, type: { kind: 'int' }, label });

export const conditionsField: RowSetFieldDef = {
  shape: 'rowset',
  id: 'conditions',
  table: 'conditions',
  columns: [
    int('SourceGroup', 'Source group'),
    int('SourceId', 'Source ID'),
    int('ElseGroup', 'Else group'),
    { name: 'ConditionTypeOrReference', type: { kind: 'enum', options: CONDITION_TYPES }, label: 'Condition' },
    int('ConditionTarget', 'Target'),
    int('ConditionValue1', 'Value 1'),
    int('ConditionValue2', 'Value 2'),
    int('ConditionValue3', 'Value 3'),
    int('NegativeCondition', 'Negate'),
    int('ErrorType', 'Error type'),
    int('ErrorTextId', 'Error text'),
    { name: 'ScriptName', type: { kind: 'string' }, label: 'Script name' },
    { name: 'Comment', type: { kind: 'string' }, label: 'Comment' },
  ],
  questColumn: 'SourceEntry',
  fixedColumns: { SourceTypeOrReferenceId: SOURCE_QUEST_AVAILABLE },
  label: 'Conditions to be offered this quest',
  help: 'All conditions in one else group must hold before the quest is offered. Different else groups are alternatives.',
  group: 'availability',
};

export const conditionsTable: TableDef = {
  table: 'conditions',
  role: 'owned',
  cardinality: 'many',
  keyColumns: [
    'SourceTypeOrReferenceId',
    'SourceGroup',
    'SourceEntry',
    'SourceId',
    'ElseGroup',
    'ConditionTypeOrReference',
    'ConditionTarget',
    'ConditionValue1',
    'ConditionValue2',
    'ConditionValue3',
  ],
  where: (questId) => ({ SourceTypeOrReferenceId: SOURCE_QUEST_AVAILABLE, SourceEntry: String(questId) }),
};

export const conditionsFields: readonly FieldDef[] = [conditionsField];

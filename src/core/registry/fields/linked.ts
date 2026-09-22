import type { FieldDef, RowSetColumn, RowSetFieldDef, TableDef } from '../types';

/**
 * The rows a quest does not own.
 *
 * *Linked* rows are found through the items the quest asks for, never through its ID: loot rows say
 * where an item drops and quest-item rows say which creature or object shows it. They are keyed by
 * their source creature or object, so two quests that need the same item share the same rows; the
 * exporter only ever touches a row by its full primary key and warns when one is shared.
 *
 * *Verbatim* rows — the locale tables — are read into the snapshot so nothing is lost, and the
 * patch never writes them: translations are not edited in this slice.
 */

const int = (name: string, label: string): RowSetColumn => ({ name, type: { kind: 'int' }, label });
const itemRef = { kind: 'idRef', target: 'item' } as const;

/** `creature_loot_template` and `gameobject_loot_template` are the same table under two names. */
const lootField = (table: string, source: string, help: string): RowSetFieldDef => ({
  shape: 'rowset',
  id: table,
  table,
  columns: [
    int('Entry', source),
    { name: 'Item', type: itemRef, label: 'Item' },
    int('Reference', 'Reference loot'),
    { name: 'Chance', type: { kind: 'float' }, label: 'Chance (%)' },
    int('QuestRequired', 'Only while on the quest'),
    int('LootMode', 'Loot mode'),
    int('GroupId', 'Group'),
    int('MinCount', 'Least dropped'),
    int('MaxCount', 'Most dropped'),
    { name: 'Comment', type: { kind: 'string' }, label: 'Comment' },
  ],
  label: `Where the item drops (${source.toLowerCase()})`,
  help,
  group: 'objectives',
  linked: true,
});

export const creatureLootTemplateField = lootField(
  'creature_loot_template',
  'Creature',
  'Creatures that drop this item, and how often. Only rows marked as quest drops belong to the quest.',
);

export const gameobjectLootTemplateField = lootField(
  'gameobject_loot_template',
  'Object',
  'Objects that contain this item, and how often. Only rows marked as quest drops belong to the quest.',
);

/** `creature_questitem` and `gameobject_questitem` differ only in the column naming the source. */
const questItemField = (table: string, entryColumn: string, source: string, help: string): RowSetFieldDef => ({
  shape: 'rowset',
  id: table,
  table,
  columns: [
    int(entryColumn, source),
    int('Idx', 'Slot'),
    { name: 'ItemId', type: itemRef, label: 'Item' },
    int('VerifiedBuild', 'Verified build'),
  ],
  label: `Quest item shown by ${source.toLowerCase()}`,
  help,
  group: 'objectives',
  linked: true,
});

export const creatureQuestitemField = questItemField(
  'creature_questitem',
  'CreatureEntry',
  'Creature',
  'Creatures that display this quest item, so the client shows the loot sparkle while the quest is in the log.',
);

export const gameobjectQuestitemField = questItemField(
  'gameobject_questitem',
  'GameObjectEntry',
  'Object',
  'Objects that display this quest item, so the client shows the loot sparkle while the quest is in the log.',
);

/**
 * A loot row only belongs to the quest when it is a quest drop: without `QuestRequired = 1` a quest
 * that needs a common item would drag in every ordinary drop of it.
 */
const lootTable = (table: string): TableDef => ({
  table,
  role: 'linked',
  cardinality: 'many',
  keyColumns: ['Entry', 'Item', 'Reference', 'GroupId'],
  itemColumn: 'Item',
  entryColumn: 'Entry',
  // The key names the creature and the item, so a collision is genuinely the same drop: there is
  // no free slot to move to, and the row is adopted (loudly) rather than re-keyed.
  where: (_questId, itemIds) => ({ Item: itemIds.map(String), QuestRequired: '1' }),
});

const questItemTable = (table: string, entryColumn: string): TableDef => ({
  table,
  role: 'linked',
  cardinality: 'many',
  keyColumns: [entryColumn, 'Idx'],
  itemColumn: 'ItemId',
  entryColumn,
  // `Idx` is only the client's slot number for this creature, so a row that would collide can be
  // moved to a free slot instead of taking over the row that is already there.
  allocatableKeyColumn: 'Idx',
  where: (_questId, itemIds) => ({ ItemId: itemIds.map(String) }),
});

export const linkedTables: readonly TableDef[] = [
  lootTable('creature_loot_template'),
  lootTable('gameobject_loot_template'),
  questItemTable('creature_questitem', 'CreatureEntry'),
  questItemTable('gameobject_questitem', 'GameObjectEntry'),
];

export const linkedFields: readonly FieldDef[] = [
  creatureLootTemplateField,
  gameobjectLootTemplateField,
  creatureQuestitemField,
  gameobjectQuestitemField,
];

/** Translations of the quest's text, one row per locale. Read, kept, never written. */
const localeTable = (table: string): TableDef => ({
  table,
  role: 'verbatim',
  cardinality: 'many',
  keyColumns: ['ID', 'locale'],
  where: (questId) => ({ ID: String(questId) }),
});

export const localeTables: readonly TableDef[] = [
  localeTable('quest_template_locale'),
  localeTable('quest_offer_reward_locale'),
  localeTable('quest_request_items_locale'),
];

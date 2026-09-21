import { questDetailsFields, questDetailsTable } from './fields/quest-details';
import { questMailSenderFields, questMailSenderTable } from './fields/quest-mail-sender';
import { questOfferRewardFields, questOfferRewardTable } from './fields/quest-offer-reward';
import { questRequestItemsFields, questRequestItemsTable } from './fields/quest-request-items';
import { questTemplateAddonFields, questTemplateAddonTable } from './fields/quest-template-addon';
import { questTemplateFields, questTemplateTable } from './fields/quest-template';
import { relationFields, relationTables } from './fields/relations';
import type { EditorGroup, FieldDef, Registry, TableDef } from './types';

/**
 * The order a patch writes the tables in, whether or not they are registered yet.
 *
 * A patch is applied top to bottom, so a half-applied one must never leave the world in a state the
 * server would act on: the starters come last, after the enders and the triggers, so a quest is
 * never offered before the row that lets a player hand it in exists. Deletes run in reverse.
 *
 * Tables not in the registry are simply skipped, so later tasks slot their tables into place here.
 */
export const TABLE_ORDER: readonly string[] = [
  'quest_template',
  'quest_template_addon',
  'quest_details',
  'quest_offer_reward',
  'quest_request_items',
  'quest_mail_sender',
  'quest_poi',
  'quest_poi_points',
  'conditions',
  'creature_loot_template',
  'gameobject_loot_template',
  'creature_questitem',
  'gameobject_questitem',
  'pool_quest',
  'game_event_creature_quest',
  'game_event_gameobject_quest',
  'areatrigger_involvedrelation',
  'creature_questender',
  'gameobject_questender',
  'creature_queststarter',
  'gameobject_queststarter',
  'quest_template_locale',
  'quest_offer_reward_locale',
  'quest_request_items_locale',
];

const ORDER = new Map(TABLE_ORDER.map((table, index) => [table, index]));

/**
 * Sorts the registered tables into `TABLE_ORDER`.
 *
 * A table nobody placed in the order would otherwise be written wherever it happened to be
 * registered, which is exactly the kind of silence that produces an unapplicable patch, so a
 * missing entry is a hard failure at module load.
 */
function inTableOrder(tables: readonly TableDef[]): TableDef[] {
  const unplaced = tables.map((t) => t.table).filter((table) => !ORDER.has(table));
  if (unplaced.length > 0) {
    throw new Error(
      `Registry error: ${unplaced.join(', ')} ${unplaced.length === 1 ? 'is' : 'are'} not in TABLE_ORDER. ` +
        'Add every registered table to TABLE_ORDER in src/core/registry/index.ts so the patch writes it in a safe place.',
    );
  }
  return [...tables].sort((a, b) => (ORDER.get(a.table) as number) - (ORDER.get(b.table) as number));
}

/**
 * The single source of truth the importer, exporter, form and round-trip gate all read.
 * Tables are sorted by `TABLE_ORDER` and fields concatenated so the emitted patch is stable.
 */
export const registry: Registry = {
  tables: inTableOrder([
    questTemplateTable,
    questTemplateAddonTable,
    questDetailsTable,
    questOfferRewardTable,
    questRequestItemsTable,
    questMailSenderTable,
    ...relationTables,
  ]),
  fields: [
    ...questTemplateFields,
    ...questTemplateAddonFields,
    ...questDetailsFields,
    ...questOfferRewardFields,
    ...questRequestItemsFields,
    ...questMailSenderFields,
    ...relationFields,
  ],
};

const fieldsById = new Map<string, FieldDef>(registry.fields.map((f) => [f.id, f]));
const tablesByName = new Map<string, TableDef>(registry.tables.map((t) => [t.table, t]));

export function fieldById(id: string): FieldDef | undefined {
  return fieldsById.get(id);
}

export function fieldsOfTable(table: string): readonly FieldDef[] {
  return registry.fields.filter((f) => f.table === table);
}

export function fieldsOfGroup(group: EditorGroup): readonly FieldDef[] {
  return registry.fields.filter((f) => f.group === group);
}

export function tableDef(table: string): TableDef {
  const def = tablesByName.get(table);
  if (!def) throw new Error(`Unknown table in registry: ${table}`);
  return def;
}

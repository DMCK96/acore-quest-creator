import type { FieldValue, Registry } from '../registry/types';
import type { QuestAggregate, Snapshot } from './aggregate';

/**
 * Which English text has a translated counterpart the tool reads but never writes.
 *
 * Spec §4.3: the three `*_locale` tables round-trip verbatim and are not edited in this slice, so a
 * rewritten enUS string leaves a localized server serving the old wording. The UI has to say so,
 * which needs two facts: whether this quest has locale rows at all, and which of its English text
 * fields the draft has moved away from what was imported.
 */

/** enUS table -> the locale table that translates it. */
const LOCALIZED_TABLES: Readonly<Record<string, string>> = {
  quest_template: 'quest_template_locale',
  quest_offer_reward: 'quest_offer_reward_locale',
  quest_request_items: 'quest_request_items_locale',
};

export const LOCALE_TABLES: readonly string[] = Object.values(LOCALIZED_TABLES);

const isTextType = (kind: string): boolean => kind === 'string' || kind === 'text';

/**
 * Field ids holding translatable English text: every scalar string/text field, and every list
 * field with a string/text member, on a table that has a locale twin.
 */
export function localizedFieldIds(registry: Registry): string[] {
  const ids: string[] = [];
  for (const field of registry.fields) {
    if (LOCALIZED_TABLES[field.table] === undefined) continue;
    if (field.shape === 'scalar' && isTextType(field.type.kind)) ids.push(field.id);
    if (field.shape === 'list' && field.members.some((m) => isTextType(m.type.kind))) ids.push(field.id);
  }
  return ids;
}

/** The locale codes the snapshot holds translated rows for, unique and sorted. */
export function localesInSnapshot(snapshot: Snapshot): string[] {
  const codes = new Set<string>();
  for (const table of LOCALE_TABLES) {
    for (const row of snapshot.tables[table] ?? []) {
      const locale = row.locale;
      if (typeof locale === 'string' && locale !== '') codes.add(locale);
    }
  }
  return [...codes].sort();
}

/**
 * The imported value of every translatable field, so the renderer can tell live which English
 * text the draft has changed without holding the snapshot itself.
 */
export function localizedTextValues(aggregate: QuestAggregate, registry: Registry): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {};
  for (const id of localizedFieldIds(registry)) {
    if (Object.prototype.hasOwnProperty.call(aggregate.values, id)) out[id] = aggregate.values[id];
  }
  return out;
}

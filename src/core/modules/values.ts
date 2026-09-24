import { valueEquals } from '../registry/codec';
import type { FieldDef, FieldValue } from '../registry/types';

/** New-quest defaults that are not an empty value, so they do not count as "set up" either. */
const BASELINE: Readonly<Record<string, FieldValue>> = { 'quest_template.QuestType': 2 };

/** True when a field holds nothing the user chose: empty, zero, or its new-quest default. */
export function isUnset(fieldId: string, value: FieldValue | undefined): boolean {
  if (value === undefined) return true;
  // New NPCs and objects are one record of two lists: unset while both are empty.
  if (fieldId === 'entities' && typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const lists = value as unknown as { npcs?: unknown[]; objects?: unknown[] };
    return (lists.npcs?.length ?? 0) === 0 && (lists.objects?.length ?? 0) === 0;
  }
  // A field with a non-empty default is unset only at that default: 0 is a real choice there.
  const baseline = BASELINE[fieldId];
  if (baseline !== undefined) return valueEquals(value, baseline);
  if (value === null || value === 0 || value === '') return true;
  return Array.isArray(value) && value.length === 0;
}

/** The value a field is reset to when the module that owns it is removed. */
export function emptyValue(field: FieldDef): FieldValue {
  const baseline = BASELINE[field.id];
  if (baseline !== undefined) return baseline;
  if (field.shape !== 'scalar') return [];
  switch (field.type.kind) {
    case 'string':
    case 'text':
      return '';
    case 'creatureOrGo':
      return { target: 'creature', id: 0 };
    default:
      return 0;
  }
}

import type { FieldDef, ScalarType } from './types';

const isWhole = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Why `value` is not a valid value of this scalar type, or null when it is. `what` names the field in the reason. */
function checkScalar(type: ScalarType, value: unknown, what: string): string | null {
  switch (type.kind) {
    case 'string':
    case 'text':
      return typeof value === 'string' ? null : `${what} must be text.`;
    case 'float':
      return typeof value === 'number' && Number.isFinite(value) ? null : `${what} must be a number.`;
    case 'int': {
      if (!isWhole(value)) return `${what} must be a whole number.`;
      const { min, max } = type;
      if (min !== undefined && max !== undefined && (value < min || value > max)) return `${what} must be a whole number between ${min} and ${max}.`;
      if (min !== undefined && value < min) return `${what} must be a whole number of at least ${min}.`;
      if (max !== undefined && value > max) return `${what} must be a whole number of at most ${max}.`;
      return null;
    }
    case 'money':
      return isWhole(value) && value >= 0 ? null : `${what} must be a whole number of copper, 0 or more.`;
    case 'idRef':
      return value === null || (isWhole(value) && value >= 0) ? null : `${what} must be an id (a whole number, 0 or more), or null for none.`;
    case 'enum': {
      if (typeof value === 'number' && type.options.some((o) => o.value === value)) return null;
      return `${what} must be one of: ${type.options.map((o) => `${o.value} (${o.label})`).join(', ')}.`;
    }
    case 'flags':
      return isWhole(value) && value >= 0 ? null : `${what} must be a whole number (the flags added together), 0 or more.`;
    case 'creatureOrGo': {
      if (value === null) return null;
      if (isRecord(value) && (value['target'] === 'creature' || value['target'] === 'gameobject') && isWhole(value['id']) && value['id'] > 0) return null;
      return `${what} must be null, or { "target": "creature" | "gameobject", "id": a positive whole number }.`;
    }
  }
}

/** The members of a list or rowset entry, each checked, and any key that is not one of them refused. */
function checkEntries(value: unknown, what: string, members: readonly { name: string; type: ScalarType }[], capacity: number | null): string | null {
  if (!Array.isArray(value)) return `${what} must be a list of objects.`;
  if (capacity !== null && value.length > capacity) return `${what} holds at most ${capacity} entries, got ${value.length}.`;
  const byName = new Map(members.map((m) => [m.name, m.type]));
  for (const [i, entry] of value.entries()) {
    if (!isRecord(entry)) return `${what} entry ${i + 1} must be an object.`;
    for (const [key, v] of Object.entries(entry)) {
      const type = byName.get(key);
      if (!type) return `${what} entry ${i + 1} has no "${key}"; its members are: ${[...byName.keys()].join(', ')}.`;
      const problem = checkScalar(type, v, `${what} entry ${i + 1} "${key}"`);
      if (problem) return problem;
    }
  }
  return null;
}

/**
 * Why `value` cannot be put in this field, or null when it can. Meant for values that come from
 * outside the editor (an MCP client): the editor's own controls cannot produce a bad one. It never
 * throws.
 */
export function checkFieldValue(field: FieldDef, value: unknown): string | null {
  const what = field.label || field.id;
  if (field.shape === 'scalar') return checkScalar(field.type, value, what);
  if (field.shape === 'list') return checkEntries(value, what, field.members, field.slots);
  return checkEntries(value, what, field.columns, null);
}

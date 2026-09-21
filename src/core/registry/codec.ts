import type { RawRow, RawValue } from '../db/types';
import { slotColumn } from './columns';
import type {
  CreatureOrGoValue,
  FieldValue,
  ListFieldDef,
  ListValue,
  RowSetFieldDef,
  ScalarType,
  ScalarValue,
} from './types';

export class CodecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CodecError';
  }
}

export class ListOverflowError extends CodecError {
  constructor(message: string) {
    super(message);
    this.name = 'ListOverflowError';
  }
}

const INT_TEXT = /^-?\d+$/;

function parseInteger(kind: string, raw: string): number {
  if (!INT_TEXT.test(raw)) throw new CodecError(`Not an integer for ${kind}: ${JSON.stringify(raw)}`);
  const n = Number(raw);
  if (!Number.isSafeInteger(n)) throw new CodecError(`Integer out of safe range for ${kind}: ${JSON.stringify(raw)}`);
  return n;
}

function isCreatureOrGo(v: ScalarValue): v is CreatureOrGoValue {
  return typeof v === 'object' && v !== null;
}

function requireInteger(kind: string, value: ScalarValue): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new CodecError(`Expected an integer for ${kind}, got ${JSON.stringify(value)}`);
  }
  return value;
}

export function decodeScalar(type: ScalarType, raw: RawValue): ScalarValue {
  if (raw === null) return null;
  switch (type.kind) {
    case 'string':
    case 'text':
      return raw;
    case 'float': {
      const n = raw.trim() === '' ? NaN : Number(raw);
      if (!Number.isFinite(n)) throw new CodecError(`Not a finite number for float: ${JSON.stringify(raw)}`);
      return n;
    }
    case 'creatureOrGo': {
      const n = parseInteger(type.kind, raw);
      if (n === 0) return null;
      return n > 0 ? { target: 'creature', id: n } : { target: 'gameobject', id: -n };
    }
    default:
      return parseInteger(type.kind, raw);
  }
}

export function encodeScalar(type: ScalarType, value: ScalarValue): RawValue {
  if (value === null) return type.kind === 'creatureOrGo' ? '0' : null;
  switch (type.kind) {
    case 'string':
    case 'text':
      if (typeof value !== 'string') throw new CodecError(`Expected a string, got ${JSON.stringify(value)}`);
      return value;
    case 'float':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new CodecError(`Expected a finite number for float, got ${JSON.stringify(value)}`);
      }
      return String(value);
    case 'creatureOrGo': {
      if (!isCreatureOrGo(value)) {
        throw new CodecError(`Expected a creature/gameobject value, got ${JSON.stringify(value)}`);
      }
      const id = requireInteger('creatureOrGo id', value.id);
      if (id <= 0) throw new CodecError(`creatureOrGo id must be positive, got ${id}`);
      if (value.target === 'creature') return String(id);
      if (value.target === 'gameobject') return String(-id);
      throw new CodecError(`Unknown creatureOrGo target: ${JSON.stringify(value.target)}`);
    }
    case 'int': {
      const n = requireInteger('int', value);
      if (type.min !== undefined && n < type.min) throw new CodecError(`${n} is below the minimum ${type.min}`);
      if (type.max !== undefined && n > type.max) throw new CodecError(`${n} is above the maximum ${type.max}`);
      return String(n);
    }
    case 'flags': {
      const n = requireInteger('flags', value);
      if (n < 0) throw new CodecError(`flags must be non-negative, got ${n}`);
      return String(n);
    }
    default:
      // enum (unknown values are legal), idRef, money
      return String(requireInteger(type.kind, value));
  }
}

const isEmptyRaw = (v: RawValue | undefined): boolean => v === undefined || v === null || v === '' || v === '0';

export function decodeList(def: ListFieldDef, row: RawRow): ListValue {
  const out: ListValue = [];
  for (let n = 1; n <= def.slots; n++) {
    const raws = def.members.map((m) => row[slotColumn(m.columnTemplate, n)]);
    if (raws.every(isEmptyRaw)) continue;
    const entry: Record<string, ScalarValue> = {};
    def.members.forEach((m, i) => {
      entry[m.name] = decodeScalar(m.type, raws[i] ?? null);
    });
    out.push(entry);
  }
  return out;
}

const isTextKind = (t: ScalarType): boolean => t.kind === 'string' || t.kind === 'text';

export function encodeList(def: ListFieldDef, value: ListValue): Record<string, RawValue> {
  if (value.length > def.slots) {
    throw new ListOverflowError(`${def.label || def.id} holds at most ${def.slots} entries, got ${value.length}`);
  }
  const out: Record<string, RawValue> = {};
  for (let n = 1; n <= def.slots; n++) {
    const entry = value[n - 1];
    for (const m of def.members) {
      const col = slotColumn(m.columnTemplate, n);
      if (entry === undefined) out[col] = isTextKind(m.type) ? '' : '0';
      else out[col] = encodeScalar(m.type, entry[m.name] ?? null);
    }
  }
  return out;
}

export function decodeRowSetRow(def: RowSetFieldDef, row: RawRow): Record<string, ScalarValue> {
  const out: Record<string, ScalarValue> = {};
  for (const c of def.columns) out[c.name] = decodeScalar(c.type, row[c.name] ?? null);
  return out;
}

export function encodeRowSetRow(def: RowSetFieldDef, value: Record<string, ScalarValue>): Record<string, RawValue> {
  const out: Record<string, RawValue> = {};
  for (const c of def.columns) out[c.name] = encodeScalar(c.type, value[c.name] ?? null);
  return out;
}

/** Strict structural equality: no coercion (`1` differs from `'1'`, `null` from `''`). */
export function valueEquals(a: FieldValue, b: FieldValue): boolean {
  return deepEqual(a, b);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Object.is(a, b);
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const ka = Object.keys(ra);
  if (ka.length !== Object.keys(rb).length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(rb, k) && deepEqual(ra[k], rb[k]));
}

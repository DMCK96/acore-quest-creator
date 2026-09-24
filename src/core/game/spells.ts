import type { RawRow } from '../db/types';
import { DbcFormatError } from './dbc';

/**
 * The server's spell list, read from `Spell.dbc` (3.3.5a, 234 fields) with the cast times and
 * ranges its indexes point at, and the world DB's `spell_dbc` rows laid over it as the server does.
 * The fork's file is ~200 MB, so only the fields the spell picker shows are read, straight from the
 * bytes; nothing else of a record is kept.
 */

export const SPELL_FILE = 'Spell.dbc';
export const CAST_TIMES_FILE = 'SpellCastTimes.dbc';
export const RANGE_FILE = 'SpellRange.dbc';

export interface SpellFacts {
  id: number;
  name: string;
  rank: string;
  /** Cast time in ms; null when the cast time index is unknown. */
  castMs: number | null;
  cooldownMs: number;
  /** Hostile max range in yards; null when the range index is unknown. */
  rangeYd: number | null;
  school: string;
  kind: 'harmful' | 'helpful' | 'unknown';
}

export interface SpellIndex {
  readonly size: number;
  get(id: number): SpellFacts | undefined;
  /** By id when the text is a whole number; otherwise by name: exact, then prefix, then substring, ties by id. */
  search(text: string, limit: number): SpellFacts[];
}

const HEADER_SIZE = 20;
const SPELL_FIELDS = 234;
const F = {
  id: 0,
  attributes: 4,
  castTimeIndex: 28,
  recovery: 29,
  categoryRecovery: 30,
  rangeIndex: 46,
  targetA: 86,
  targetB: 89,
  name: 136,
  rank: 153,
  schoolMask: 225,
} as const;

const SCHOOLS = ['Physical', 'Holy', 'Fire', 'Nature', 'Frost', 'Shadow', 'Arcane'];
/** Implicit targets that aim at enemies: unit/area/cone enemy and the enemy's position. */
const ENEMY_TARGETS = new Set([6, 15, 16, 24, 53]);
/** Implicit targets that aim at the caster or its allies. */
const FRIENDLY_TARGETS = new Set([1, 20, 21, 30, 31]);
/** `SPELL_ATTR0_AURA_IS_DEBUFF`: forces the spell to count as negative. */
const ATTR_DEBUFF = 0x04000000;

interface Header {
  view: DataView;
  count: number;
  fieldCount: number;
  recordSize: number;
  strings: number;
}

function header(bytes: Uint8Array, name: string, minFields: number): Header {
  if (bytes.length < HEADER_SIZE) throw new DbcFormatError(`${name} is too short to be a DBC file.`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
  if (magic !== 'WDBC') throw new DbcFormatError(`${name} is not a WDBC file (it starts with "${magic}").`);
  const count = view.getUint32(4, true);
  const fieldCount = view.getUint32(8, true);
  const recordSize = view.getUint32(12, true);
  const stringSize = view.getUint32(16, true);
  if (fieldCount < minFields) throw new DbcFormatError(`${name} has ${fieldCount} fields; a 3.3.5a file has at least ${minFields}.`);
  if (recordSize < fieldCount * 4) throw new DbcFormatError(`${name} has ${fieldCount} fields but only ${recordSize} bytes per record.`);
  if (HEADER_SIZE + count * recordSize + stringSize !== bytes.length) {
    throw new DbcFormatError(`${name} is ${bytes.length} bytes, which does not match its header.`);
  }
  return { view, count, fieldCount, recordSize, strings: HEADER_SIZE + count * recordSize };
}

/** Field 0 of each record to one other field, read as an int or a float. */
function lookup(bytes: Uint8Array | null, name: string, minFields: number, field: number, float: boolean): Map<number, number> {
  const map = new Map<number, number>();
  if (!bytes) return map;
  const h = header(bytes, name, minFields);
  for (let r = 0; r < h.count; r += 1) {
    const at = HEADER_SIZE + r * h.recordSize;
    map.set(h.view.getUint32(at, true), float ? h.view.getFloat32(at + field * 4, true) : h.view.getInt32(at + field * 4, true));
  }
  return map;
}

function schoolOf(mask: number): string {
  return SCHOOLS.filter((_, bit) => (mask & (1 << bit)) !== 0).join('/');
}

function kindOf(targetsA: readonly number[], targetsB: readonly number[], attributes: number): SpellFacts['kind'] {
  if ([...targetsA, ...targetsB].some((t) => ENEMY_TARGETS.has(t))) return 'harmful';
  if (targetsA.some((t) => FRIENDLY_TARGETS.has(t))) return 'helpful';
  if ((attributes & ATTR_DEBUFF) !== 0) return 'harmful';
  return 'unknown';
}

export function readSpellIndex(input: {
  spell: Uint8Array;
  castTimes: Uint8Array | null;
  ranges: Uint8Array | null;
  /** `spell_dbc` rows: each replaces or adds a whole spell. */
  overrides?: readonly RawRow[];
}): SpellIndex {
  const casts = lookup(input.castTimes, CAST_TIMES_FILE, 2, 1, false);
  const ranges = lookup(input.ranges, RANGE_FILE, 4, 3, true);
  const castMs = (index: number): number | null => (input.castTimes ? (casts.get(index) ?? null) : null);
  const rangeYd = (index: number): number | null => {
    const r = input.ranges ? ranges.get(index) : undefined;
    return r === undefined ? null : Math.round(r * 100) / 100;
  };
  const facts = (f: {
    id: number; name: string; rank: string; castIndex: number; recovery: number; categoryRecovery: number;
    rangeIndex: number; school: number; targetsA: number[]; targetsB: number[]; attributes: number;
  }): SpellFacts => ({
    id: f.id, name: f.name, rank: f.rank, castMs: castMs(f.castIndex), cooldownMs: Math.max(f.recovery, f.categoryRecovery),
    rangeYd: rangeYd(f.rangeIndex), school: schoolOf(f.school), kind: kindOf(f.targetsA, f.targetsB, f.attributes),
  });

  const h = header(input.spell, SPELL_FILE, SPELL_FIELDS);
  const decoder = new TextDecoder();
  const bytes = input.spell;
  const stringAt = (offset: number): string => {
    const start = h.strings + offset;
    let end = start;
    while (end < bytes.length && bytes[end] !== 0) end += 1;
    return decoder.decode(bytes.subarray(start, end));
  };
  const byId = new Map<number, SpellFacts>();
  for (let r = 0; r < h.count; r += 1) {
    const at = HEADER_SIZE + r * h.recordSize;
    const u = (field: number): number => h.view.getUint32(at + field * 4, true);
    const id = u(F.id);
    byId.set(id, facts({
      id, name: stringAt(u(F.name)), rank: stringAt(u(F.rank)), castIndex: u(F.castTimeIndex), recovery: u(F.recovery),
      categoryRecovery: u(F.categoryRecovery), rangeIndex: u(F.rangeIndex), school: u(F.schoolMask),
      targetsA: [u(F.targetA), u(F.targetA + 1), u(F.targetA + 2)], targetsB: [u(F.targetB), u(F.targetB + 1), u(F.targetB + 2)],
      attributes: u(F.attributes),
    }));
  }

  const n = (raw: string | null | undefined): number => {
    const v = Number(raw ?? 0);
    return Number.isFinite(v) ? v : 0;
  };
  for (const row of input.overrides ?? []) {
    const id = n(row.ID);
    if (id <= 0) continue;
    byId.set(id, facts({
      id, name: row.Name_Lang_enUS ?? '', rank: row.NameSubtext_Lang_enUS ?? '', castIndex: n(row.CastingTimeIndex),
      recovery: n(row.RecoveryTime), categoryRecovery: n(row.CategoryRecoveryTime), rangeIndex: n(row.RangeIndex),
      school: n(row.SchoolMask), targetsA: [n(row.ImplicitTargetA_1)], targetsB: [n(row.ImplicitTargetB_1)], attributes: n(row.Attributes),
    }));
  }

  const names: [string, SpellFacts][] = [];
  for (const spell of byId.values()) if (spell.name !== '') names.push([spell.name.toLowerCase(), spell]);
  names.sort((a, b) => a[1].id - b[1].id);

  return {
    size: byId.size,
    get: (id) => byId.get(id),
    search(text, limit) {
      const needle = text.trim().toLowerCase();
      if (needle === '') return [];
      if (/^\d+$/.test(needle)) {
        const hit = byId.get(Number(needle));
        return hit ? [hit] : [];
      }
      const exact: SpellFacts[] = [];
      const prefix: SpellFacts[] = [];
      const inside: SpellFacts[] = [];
      for (const [name, spell] of names) {
        if (name === needle) exact.push(spell);
        else if (name.startsWith(needle)) prefix.push(spell);
        else if (name.includes(needle)) inside.push(spell);
      }
      return [...exact, ...prefix, ...inside].slice(0, limit);
    },
  };
}

/** The short facts shown beside a spell's name: rank · cast · cooldown · range · school · kind. */
export function spellDetail(f: SpellFacts): string {
  const parts: string[] = [];
  if (f.rank) parts.push(f.rank);
  if (f.castMs === 0) parts.push('instant');
  else if (f.castMs !== null && f.castMs > 0) parts.push(`${f.castMs / 1000} s cast`);
  if (f.cooldownMs > 0) parts.push(`${f.cooldownMs / 1000} s cooldown`);
  if (f.rangeYd !== null && f.rangeYd > 0 && f.rangeYd < 50000) parts.push(`${f.rangeYd} yd`);
  if (f.school) parts.push(f.school);
  if (f.kind !== 'unknown') parts.push(f.kind);
  return parts.join(' · ');
}

/** The spell's name with its rank, as pickers and summaries show it. */
export function spellLabel(f: SpellFacts): string {
  return f.rank ? `${f.name} (${f.rank})` : f.name;
}

import { defaultValueFor, isNumericColumn } from '@core/db/types';
import type { ColumnInfo, RawRow, RawValue, RefKind, Where } from '@core/db/types';
import {
  LOOKUP_KINDS,
  UnknownColumnError,
  UnknownTableError,
  type QuestSummary,
  type WorldDb,
} from '@core/db/world-db';
import { loadFork } from './ddl';
import { SPAWN_TABLES, spawnEntryColumn, toSpawnDot, type MapBox, type SpawnDot, type SpawnKind } from '@core/db/spawns';
import { ENTITY_TABLES, ID_TEXT, rankHits, toHit, type DbSearchKind, type EntityHit } from '@core/db/entity-search';
import { orderPath, pickPreset, toViewCreature, toViewObject, type ViewCreature, type ViewObject } from '@core/db/view-spawns';

type MutableRow = Record<string, RawValue>;
interface Table {
  columns: ColumnInfo[];
  rows: MutableRow[];
}

/** kind -> [table, id column, name column] */
const LOOKUP: Partial<Record<RefKind, readonly [string, string, string]>> = {
  item: ['item_template', 'entry', 'name'],
  creature: ['creature_template', 'entry', 'name'],
  gameobject: ['gameobject_template', 'entry', 'name'],
  quest: ['quest_template', 'ID', 'LogTitle'],
};

const INTEGER = /^-?\d+$/;

function compareNumeric(a: RawValue, b: RawValue): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? -1 : 1;
  if (INTEGER.test(a) && INTEGER.test(b)) {
    const x = BigInt(a);
    const y = BigInt(b);
    return x < y ? -1 : x > y ? 1 : 0;
  }
  return Number(a) - Number(b);
}

function compareText(a: RawValue, b: RawValue): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function lookupSpec(kind: RefKind): readonly [string, string, string] | undefined {
  return LOOKUP_KINDS.includes(kind) ? LOOKUP[kind] : undefined;
}

/** In-memory WorldDb for unit tests. Behaves like the MySQL implementation: text values, key ordering. */
export class FakeWorldDb implements WorldDb {
  private readonly tables = new Map<string, Table>();
  /** Tables the database has but this "user" may not read, as MySQL would hide them. */
  private readonly forbidden = new Set<string>();

  static fromFork(tables: string[]): FakeWorldDb {
    const db = new FakeWorldDb();
    for (const [name, columns] of Object.entries(loadFork(tables))) db.tables.set(name, { columns, rows: [] });
    return db;
  }

  private table(name: string): Table {
    const t = this.tables.get(name);
    if (!t) throw new UnknownTableError(name);
    return t;
  }

  private checkColumns(name: string, t: Table, names: Iterable<string>): void {
    const known = new Set(t.columns.map((c) => c.name));
    for (const n of names) if (!known.has(n)) throw new UnknownColumnError(name, n);
  }

  insert(table: string, partial: Record<string, string | null>): void {
    const t = this.table(table);
    this.checkColumns(table, t, Object.keys(partial));
    const row: MutableRow = {};
    for (const c of t.columns) row[c.name] = c.name in partial ? partial[c.name] : defaultValueFor(c);
    t.rows.push(row);
  }

  addColumn(table: string, col: ColumnInfo): void {
    const t = this.table(table);
    t.columns.push({ ...col });
    t.columns.sort((a, b) => a.ordinal - b.ordinal);
    for (const row of t.rows) row[col.name] = defaultValueFor(col);
  }

  dropTable(table: string): void {
    this.tables.delete(table);
  }

  /**
   * Makes a table invisible the way a missing `SELECT` grant does: `columns()` answers `[]`, just
   * as `INFORMATION_SCHEMA` would, but the probe can still tell it is there.
   */
  forbidTable(table: string): void {
    this.tables.delete(table);
    this.forbidden.add(table);
  }

  async probeMissingTable(table: string): Promise<'absent' | 'forbidden'> {
    return this.forbidden.has(table) ? 'forbidden' : 'absent';
  }

  update(table: string, where: Record<string, string>, partial: Record<string, string | null>): void {
    const t = this.table(table);
    this.checkColumns(table, t, [...Object.keys(where), ...Object.keys(partial)]);
    for (const row of t.rows) {
      if (Object.entries(where).every(([k, v]) => row[k] === v)) Object.assign(row, partial);
    }
  }

  all(table: string): RawRow[] {
    return this.table(table).rows.map((r) => ({ ...r }));
  }

  async columns(table: string): Promise<ColumnInfo[]> {
    const t = this.tables.get(table);
    return t ? t.columns.map((c) => ({ ...c })).sort((a, b) => a.ordinal - b.ordinal) : [];
  }

  async selectRows(table: string, where: Where): Promise<RawRow[]> {
    const t = this.table(table);
    this.checkColumns(table, t, Object.keys(where));
    const matches = t.rows.filter((row) =>
      Object.entries(where).every(([col, want]) =>
        typeof want === 'string' ? row[col] === want : want.some((w) => row[col] === w),
      ),
    );
    const keys = t.columns.filter((c) => c.isKey);
    const sorted = matches.slice().sort((a, b) => {
      for (const k of keys) {
        const cmp = (isNumericColumn(k) ? compareNumeric : compareText)(a[k.name], b[k.name]);
        if (cmp !== 0) return cmp;
      }
      return 0;
    });
    return sorted.map((r) => ({ ...r }));
  }

  clear(table: string): void {
    this.table(table).rows.length = 0;
  }

  async selectByPrefix(table: string, column: string, prefix: string): Promise<RawRow[]> {
    this.checkColumns(table, this.table(table), [column]);
    return (await this.selectRows(table, {})).filter((row) => typeof row[column] === 'string' && row[column]!.startsWith(prefix));
  }

  async selectMax(table: string, column: string): Promise<number | null> {
    this.checkColumns(table, this.table(table), [column]);
    const values = this.table(table).rows.map((r) => r[column]).filter((v): v is string => v !== null).map(Number);
    return values.length === 0 ? null : Math.max(...values);
  }

  async selectNonZero(table: string, column: string): Promise<RawRow[]> {
    this.checkColumns(table, this.table(table), [column]);
    return (await this.selectRows(table, {})).filter((row) => row[column] !== null && Number(row[column]) !== 0);
  }

  async spawnsInBox(kind: SpawnKind, map: number, box: MapBox, limit: number): Promise<SpawnDot[]> {
    return (await this.spawnDots(kind))
      .filter((d) => d.map === map && d.x >= box.minX && d.x <= box.maxX && d.y >= box.minY && d.y <= box.maxY)
      .slice(0, limit);
  }

  async spawnsForView(map: number, box: MapBox, limit: number): Promise<{ creatures: ViewCreature[]; objects: ViewObject[] }> {
    const inBox = (r: RawRow) => {
      const x = Number(r.position_x), y = Number(r.position_y);
      return Number(r.map) === map && x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY;
    };
    const byGuid = (a: RawRow, b: RawRow) => Number(a.guid) - Number(b.guid);

    const entryColumn = spawnEntryColumn('creature', this.table('creature').columns.map((c) => c.name));
    const names = new Map((await this.selectRows('creature_template', {})).map((r) => [r.entry, r.name ?? null]));
    // The template's first model: the lowest Idx
    const models = new Map<string, RawRow>();
    for (const m of await this.selectRows('creature_template_model', {})) {
      const known = models.get(m.CreatureID ?? '');
      if (!known || Number(m.Idx) < Number(known.Idx)) models.set(m.CreatureID ?? '', m);
    }
    const addons = new Map((await this.selectRows('creature_addon', {})).map((a) => [a.guid, a.path_id]));
    // A spawn without a route of its own walks its template's, when the database has template addons
    const templateAddons = this.tables.has('creature_template_addon')
      ? new Map((await this.selectRows('creature_template_addon', {})).map((a) => [a.entry, a.path_id]))
      : new Map<string | null, string | null>();
    const waypoints = await this.selectRows('waypoint_data', {});
    const equips = await this.selectRows('creature_equip_template', {});
    const presets = this.tables.has('creature_display_preset') ? await this.selectRows('creature_display_preset', {}) : [];
    const creatures = (await this.selectRows('creature', {})).filter(inBox).sort(byGuid).slice(0, limit).map((r) => {
      const entry = r[entryColumn] ?? null;
      const model = models.get(entry ?? '');
      const own = addons.get(r.guid);
      const pathId = own && own !== '0' ? own : templateAddons.get(entry);
      const points = pathId && pathId !== '0' ? waypoints.filter((w) => w.id === pathId) : [];
      const equip = r.equipment_id && r.equipment_id !== '0' ? equips.find((e) => e.CreatureID === entry && e.ID === r.equipment_id) : undefined;
      return toViewCreature(
        { ...r, entry, name: names.get(entry) ?? null, display_id: model?.CreatureDisplayID ?? null, display_scale: model?.DisplayScale ?? null, path_id: pathId ?? null },
        points.length > 0 ? orderPath(points) : null,
        equip ? [Number(equip.ItemID1 ?? 0), Number(equip.ItemID2 ?? 0), Number(equip.ItemID3 ?? 0)] : [0, 0, 0],
        presets.length > 0 ? pickPreset(presets, Number(entry), Number(model?.CreatureDisplayID ?? 0)) : null,
      );
    });

    const templates = new Map((await this.selectRows('gameobject_template', {})).map((t) => [t.entry, t]));
    const objects = (await this.selectRows('gameobject', {})).filter(inBox).sort(byGuid).slice(0, limit).map((r) => {
      const t = templates.get(r.id ?? null);
      return toViewObject({ ...r, entry: r.id ?? null, name: t?.name ?? null, display_id: t?.displayId ?? null, size: t?.size ?? null });
    });

    return { creatures, objects };
  }

  async spawnsOfEntries(kind: SpawnKind, entries: readonly number[], limit: number): Promise<SpawnDot[]> {
    return (await this.spawnDots(kind)).filter((d) => entries.includes(d.entry)).slice(0, limit);
  }

  private async spawnDots(kind: SpawnKind): Promise<SpawnDot[]> {
    const spec = SPAWN_TABLES[kind];
    const column = spawnEntryColumn(kind, this.table(spec.table).columns.map((c) => c.name));
    const names = new Map((await this.selectRows(spec.template, {})).map((r) => [r.entry, r.name ?? '']));
    return (await this.selectRows(spec.table, {}))
      .map((r) => toSpawnDot(kind, { ...r, entry: r[column] ?? null, name: names.get(r[column] ?? null) ?? '' }))
      .sort((a, b) => a.guid - b.guid);
  }

  async searchQuests(text: string, limit: number): Promise<QuestSummary[]> {
    const rows = await this.selectRows('quest_template', {});
    const needle = text.toLowerCase();
    const hits = /^\d+$/.test(text)
      ? rows.filter((r) => r.ID !== null && BigInt(r.ID) === BigInt(text))
      : rows.filter((r) => (r.LogTitle ?? '').toLowerCase().includes(needle));
    return hits.slice(0, limit).map((r) => ({ id: Number(r.ID), title: r.LogTitle ?? '', level: Number(r.QuestLevel) }));
  }

  async searchEntities(kind: DbSearchKind, text: string, limit: number): Promise<EntityHit[]> {
    const needle = text.trim();
    if (needle === '') return [];
    const spec = ENTITY_TABLES[kind];
    const rows = await this.selectRows(spec.table, {});
    const matches = ID_TEXT.test(needle)
      ? rows.filter((r) => r[spec.id] === needle)
      : rows.filter((r) => (r[spec.name] ?? '').toLowerCase().includes(needle.toLowerCase()));
    return rankHits(matches.map((r) => toHit(kind, r)), needle).slice(0, limit);
  }

  async lookupNames(kind: RefKind, ids: readonly number[]): Promise<Map<number, string>> {
    const out = new Map<number, string>();
    const spec = lookupSpec(kind);
    if (!spec || ids.length === 0) return out;
    const [table, idCol, nameCol] = spec;
    const rows = await this.selectRows(table, { [idCol]: ids.map(String) });
    for (const r of rows) out.set(Number(r[idCol]), r[nameCol] ?? '');
    return out;
  }

  async existingIds(kind: RefKind, ids: readonly number[]): Promise<Set<number>> {
    const spec = lookupSpec(kind);
    if (!spec) return new Set(ids);
    if (ids.length === 0) return new Set();
    const [table, idCol] = spec;
    const rows = await this.selectRows(table, { [idCol]: ids.map(String) });
    return new Set(rows.map((r) => Number(r[idCol])));
  }

  async questIdsInRange(from: number, to: number): Promise<number[]> {
    return (await this.selectRows('quest_template', {}))
      .map((r) => Number(r.ID))
      .filter((id) => id >= from && id <= to);
  }

  async close(): Promise<void> {}
}

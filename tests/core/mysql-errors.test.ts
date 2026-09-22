import { describe, it, expect } from 'vitest';
import {
  classifyMysqlError,
  WorldDbConnectionError,
  WorldDbPermissionError,
  WorldDbQueryError,
} from '@core/db/mysql-world-db';
import { loadSchema } from '@core/schema/load';
import { diffSchema } from '@core/schema/diff';
import { registry } from '@core/registry';
import type { ColumnInfo, RefKind, Where } from '@core/db/types';
import type { QuestSummary, WorldDb } from '@core/db/world-db';

const err = (code: string, message = code): Error => Object.assign(new Error(message), { code });
const thrown = (code: string, message?: string): unknown => {
  try {
    classifyMysqlError('h', 3306, err(code, message), 'reading quest_template');
  } catch (e) {
    return e;
  }
  return undefined;
};

describe('classifyMysqlError', () => {
  it('keeps genuine connection failures as WorldDbConnectionError', () => {
    for (const code of ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH', 'PROTOCOL_CONNECTION_LOST', 'ER_ACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR']) {
      expect(thrown(code), code).toBeInstanceOf(WorldDbConnectionError);
    }
    expect(thrown('SOMETHING', 'Query inactivity timeout')).toBeInstanceOf(WorldDbConnectionError);
  });

  it('reports a missing grant as a permission problem, not a connection problem', () => {
    for (const code of ['ER_TABLEACCESS_DENIED_ERROR', 'ER_DBACCESS_DENIED_ERROR', 'ER_COLUMNACCESS_DENIED_ERROR']) {
      const e = thrown(code);
      expect(e, code).toBeInstanceOf(WorldDbPermissionError);
      expect(e, code).not.toBeInstanceOf(WorldDbConnectionError);
      expect((e as Error).message).toContain('permission');
      expect((e as Error).message).toContain('reading quest_template');
    }
  });

  it('reports any other query failure as a query error naming what was being done', () => {
    const e = thrown('ER_NO_SUCH_TABLE');
    expect(e).toBeInstanceOf(WorldDbQueryError);
    expect(e).not.toBeInstanceOf(WorldDbConnectionError);
    expect((e as Error).message).toContain('reading quest_template');
    expect((e as Error).message).toContain('ER_NO_SUCH_TABLE');
    expect(thrown('ER_PARSE_ERROR')).toBeInstanceOf(WorldDbQueryError);
  });

  it('gives every named error a distinct `name`, so the API can map it to a code', () => {
    const names = ['ECONNREFUSED', 'ER_TABLEACCESS_DENIED_ERROR', 'ER_NO_SUCH_TABLE'].map((c) => (thrown(c) as Error).name);
    expect(new Set(names).size).toBe(3);
    expect(names).toEqual(['WorldDbConnectionError', 'WorldDbPermissionError', 'WorldDbQueryError']);
  });
});

/**
 * INFORMATION_SCHEMA hides a table the querying user has no privilege on, so introspection alone
 * cannot tell "this fork does not have the table" from "you may not read it" — and the importer
 * would go on to produce a partial import either way.
 */
class ProbingDb implements WorldDb {
  constructor(
    private readonly present: Record<string, ColumnInfo[]>,
    private readonly forbidden: ReadonlySet<string>,
  ) {}
  async columns(table: string): Promise<ColumnInfo[]> {
    return this.present[table] ?? [];
  }
  async probeMissingTable(table: string): Promise<'absent' | 'forbidden'> {
    return this.forbidden.has(table) ? 'forbidden' : 'absent';
  }
  async selectRows(): Promise<never[]> {
    return [];
  }
  async searchQuests(): Promise<QuestSummary[]> {
    return [];
  }
  async lookupNames(_k: RefKind, _i: readonly number[]): Promise<Map<number, string>> {
    return new Map();
  }
  async existingIds(): Promise<Set<number>> {
    return new Set();
  }
  async questIdsInRange(): Promise<number[]> {
    return [];
  }
  async close(): Promise<void> {}
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private readonly _where: Where | undefined = undefined;
}

const col: ColumnInfo = { name: 'ID', dataType: 'int', columnType: 'int', nullable: false, default: '0', ordinal: 1, isKey: true };

describe('schema load distinguishes a forbidden table from an absent one', () => {
  it('records the forbidden tables separately', async () => {
    const db = new ProbingDb({ quest_template: [col] }, new Set(['quest_poi']));
    const schema = await loadSchema(db, ['quest_template', 'quest_poi', 'conditions']);
    expect(Object.keys(schema.tables)).toEqual(['quest_template']);
    expect(schema.forbidden).toEqual(['quest_poi']);
  });

  it('carries them into the drift report so the connect notice can say which is which', async () => {
    const db = new ProbingDb({ quest_template: [col] }, new Set(['quest_poi']));
    const schema = await loadSchema(db, registry.tables.map((t) => t.table));
    const drift = diffSchema(schema, registry);
    expect(drift.forbiddenTables).toEqual(['quest_poi']);
    expect(drift.missingTables).toContain('quest_poi');
    // A table that simply is not in this fork stays out of the forbidden list.
    expect(drift.forbiddenTables).not.toContain('conditions');
  });

  it('leaves `forbidden` empty for a driver that cannot probe at all', async () => {
    const plain: WorldDb = {
      columns: async (t) => (t === 'quest_template' ? [col] : []),
      selectRows: async () => [],
      searchQuests: async () => [],
      lookupNames: async () => new Map(),
      existingIds: async () => new Set(),
      questIdsInRange: async () => [],
      close: async () => {},
    };
    expect(plain.probeMissingTable).toBeUndefined();
    const schema = await loadSchema(plain, ['quest_template', 'quest_poi']);
    expect(schema.forbidden).toEqual([]);
    expect(Object.keys(schema.tables)).toEqual(['quest_template']);
  });
});

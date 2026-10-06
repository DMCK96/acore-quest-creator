import type { RawRow, Where } from './types';
import { UnknownColumnError, UnknownTableError, type WorldDb } from './world-db';

/** A table's rows, or none when the table or a column of the query is not in this database */
export async function rowsOrNone(db: Pick<WorldDb, 'selectRows'>, table: string, where: Where): Promise<RawRow[]> {
  try {
    return await db.selectRows(table, where);
  } catch (error) {
    if (error instanceof UnknownTableError || error instanceof UnknownColumnError) return [];
    throw error;
  }
}

import { describe, it, expect } from 'vitest';
import { quoteString, renderValue, renderInsert, renderDelete, SqlRenderError } from '@core/sql/render';
import { defaultValueFor, isNumericColumn, type ColumnInfo } from '@core/db/types';

const col = (name: string, dataType: string, o: Partial<ColumnInfo> = {}): ColumnInfo => ({
  name, dataType, columnType: dataType, nullable: false, default: null, ordinal: 1, isKey: false, ...o,
});
const id = col('ID', 'mediumint', { isKey: true, ordinal: 1 });
const title = col('LogTitle', 'text', { nullable: true, ordinal: 2 });
const price = col('Chance', 'float', { ordinal: 3 });

describe('quoteString', () => {
  it('escapes backslash, quote, NUL and Ctrl-Z, keeps everything else raw', () => {
    expect(quoteString("it's")).toBe("'it\\'s'");
    expect(quoteString('a\\b')).toBe("'a\\\\b'");
    expect(quoteString('x\0y')).toBe("'x\\0y'");
    expect(quoteString('x\x1ay')).toBe("'x\\Zy'");
    expect(quoteString('l1\r\nl2\t$B 🙂  ')).toBe("'l1\r\nl2\t$B 🙂  '");
    expect(quoteString('')).toBe("''");
  });
});

describe('renderValue', () => {
  it('renders NULL only for nullable columns', () => {
    expect(renderValue(title, null)).toBe('NULL');
    expect(() => renderValue(id, null)).toThrow(SqlRenderError);
  });
  it('emits numeric text verbatim and rejects non-numeric text', () => {
    expect(renderValue(price, '1.50')).toBe('1.50');
    expect(renderValue(price, '-0')).toBe('-0');
    expect(renderValue(price, '1e-7')).toBe('1e-7');
    expect(renderValue(id, '4294967295')).toBe('4294967295');
    expect(() => renderValue(id, '1; DROP TABLE x')).toThrow(SqlRenderError);
    expect(() => renderValue(id, '')).toThrow(SqlRenderError);
  });
  it('distinguishes NULL from empty string', () => {
    expect(renderValue(title, '')).toBe("''");
  });
});

describe('renderInsert / renderDelete', () => {
  it('renders columns in ordinal order with backtick-quoted identifiers', () => {
    expect(renderInsert('quest_template', [title, id], { ID: '5', LogTitle: "O'Neil" }))
      .toBe("INSERT INTO `quest_template` (`ID`, `LogTitle`) VALUES (5, 'O\\'Neil');");
  });
  it('rejects rows with missing or unknown columns', () => {
    expect(() => renderInsert('t', [id, title], { ID: '5' })).toThrow(SqlRenderError);
    expect(() => renderInsert('t', [id], { ID: '5', Extra: 'x' })).toThrow(SqlRenderError);
  });
  it('renders a key delete', () => {
    expect(renderDelete('quest_template', [id], { ID: '5' })).toBe('DELETE FROM `quest_template` WHERE `ID` = 5;');
  });
});

describe('column helpers', () => {
  it('classifies numeric columns and defaults', () => {
    expect(isNumericColumn(id)).toBe(true);
    expect(isNumericColumn(title)).toBe(false);
    expect(defaultValueFor(col('a', 'int', { default: '7' }))).toBe('7');
    expect(defaultValueFor(title)).toBeNull();
    expect(defaultValueFor(col('b', 'int'))).toBe('0');
    expect(defaultValueFor(col('c', 'varchar'))).toBe('');
  });
});

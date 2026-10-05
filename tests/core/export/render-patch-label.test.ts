import { describe, expect, it } from 'vitest';
import { renderPatch } from '../../../src/core/export/render-patch';

describe('a patch that is not a quest\'s', () => {
  it('names its label in the header instead of a quest', () => {
    const sql = renderPatch([], { tables: {}, forbidden: [], hash: 'h' }, { toolVersion: '1', date: '2026-10-03', label: 'World changes' });
    expect(sql.split('\n').slice(0, 2)).toEqual(['-- Azeroth World Editor 1', '-- World changes']);
  });
});

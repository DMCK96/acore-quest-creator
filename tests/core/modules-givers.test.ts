import { describe, it, expect } from 'vitest';
import { readGivers, writeGivers } from '@core/modules/givers';

describe('quest givers', () => {
  const values = {
    creature_queststarter: [{ id: 240 }, { id: 241 }],
    gameobject_queststarter: [{ id: 3000 }],
    creature_questender: [{ id: 240 }],
    gameobject_questender: [],
  };
  it('reads creatures first, then objects, keeping each table order', () => {
    expect(readGivers(values, 'start')).toEqual([
      { kind: 'creature', id: 240 },
      { kind: 'creature', id: 241 },
      { kind: 'gameobject', id: 3000 },
    ]);
    expect(readGivers(values, 'end')).toEqual([{ kind: 'creature', id: 240 }]);
  });
  it('reads a missing table as no rows', () => {
    expect(readGivers({}, 'start')).toEqual([]);
  });
  it('writes both tables of the role, split by kind', () => {
    expect(writeGivers('start', [{ kind: 'gameobject', id: 7 }, { kind: 'creature', id: 5 }])).toEqual({
      creature_queststarter: [{ id: 5 }],
      gameobject_queststarter: [{ id: 7 }],
    });
    expect(writeGivers('end', [])).toEqual({ creature_questender: [], gameobject_questender: [] });
  });
  it('round-trips', () => {
    const targets = readGivers(values, 'start');
    expect(readGivers({ ...values, ...writeGivers('start', targets) }, 'start')).toEqual(targets);
  });
});

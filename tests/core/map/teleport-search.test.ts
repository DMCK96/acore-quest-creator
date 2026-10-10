import { describe, expect, it } from 'vitest';
import { resolveSpot, searchTeleports } from '../../../src/core/map/teleport-search';
import type { TeleportSpot } from '../../../src/core/map/teleports';

const spot = (name: string, zone: string, region = 'Kalimdor'): TeleportSpot => ({ region, zone, name, map: 1, x: 1, y: 2, z: 3 });
const spots = [spot('Orgrimmar', 'Durotar'), spot('Orgrimmar Gate', 'Durotar'), spot('Stormwind City', 'Elwynn Forest', 'Eastern Kingdoms'), spot('Razor Hill', 'Durotar')];

describe('searchTeleports', () => {
  it('ranks an exact name first, then names that start with it, then any word match', () => {
    expect(searchTeleports(spots, 'orgrimmar', 10).map((s) => s.name)).toEqual(['Orgrimmar', 'Orgrimmar Gate']);
  });
  it('matches the zone and the region too, every word of the query', () => {
    expect(searchTeleports(spots, 'durotar razor', 10).map((s) => s.name)).toEqual(['Razor Hill']);
    expect(searchTeleports(spots, 'eastern', 10).map((s) => s.name)).toEqual(['Stormwind City']);
  });
  it('keeps to the limit and finds nothing for nonsense', () => {
    expect(searchTeleports(spots, 'durotar', 2)).toHaveLength(2);
    expect(searchTeleports(spots, 'zzz', 5)).toEqual([]);
  });
});

describe('resolveSpot', () => {
  it('takes an exact name, ignoring case', () => {
    expect(resolveSpot(spots, 'ORGRIMMAR')).toMatchObject({ spot: { name: 'Orgrimmar' } });
  });
  it('takes a single partial match', () => {
    expect(resolveSpot(spots, 'stormwind')).toMatchObject({ spot: { name: 'Stormwind City' } });
  });
  it('lists the candidates when several match and none is exact', () => {
    const out = resolveSpot(spots, 'durotar');
    expect('candidates' in out && out.candidates.map((s) => s.name)).toEqual(['Orgrimmar', 'Orgrimmar Gate', 'Razor Hill']);
  });
  it('says nothing matched', () => {
    expect(resolveSpot(spots, 'zzz')).toEqual({ candidates: [] });
  });
});

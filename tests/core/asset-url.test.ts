import { describe, expect, it } from 'vitest';
import { assetUrl, parseAssetUrl } from '../../src/core/client/asset-url';
import { WORLD_MAPS, worldMapById, worldMapDirectory } from '../../src/core/map/world-maps';

describe('client file addresses', () => {
  it('names the client path a url asks for', () => {
    expect(parseAssetUrl('awe-wow://file/world/maps/azeroth/azeroth.wdt')).toBe('world/maps/azeroth/azeroth.wdt');
    expect(parseAssetUrl('awe-wow://file/dbfilesclient/map.dbc?x=1')).toBe('dbfilesclient/map.dbc');
    expect(parseAssetUrl('awe-wow://file/creature/a%20b/c.m2')).toBe('creature/a b/c.m2');
  });
  it('refuses another scheme, an empty path, a path that climbs out and a broken escape', () => {
    expect(parseAssetUrl('awe-map://tile/0/6/1/1.png')).toBeNull();
    expect(parseAssetUrl('awe-wow://file/')).toBeNull();
    expect(parseAssetUrl('awe-wow://file/../secret')).toBeNull();
    expect(parseAssetUrl('awe-wow://file/a/..%5Cb')).toBeNull();
    expect(parseAssetUrl('awe-wow://file/%E0%A4%A')).toBeNull();
  });
  it('round-trips a path', () => {
    expect(parseAssetUrl(assetUrl('world/maps/a b/c.adt'))).toBe('world/maps/a b/c.adt');
  });
});

describe('3D maps', () => {
  it('knows the four continents and nothing else', () => {
    expect(worldMapDirectory(0)).toBe('azeroth');
    expect(worldMapDirectory(571)).toBe('northrend');
    expect(worldMapDirectory(33)).toBeNull();
    expect(WORLD_MAPS.map((m) => m.id)).toEqual([0, 1, 530, 571]);
    expect(worldMapById(1)?.name).toBe('Kalimdor');
    expect(worldMapById(33)).toBeNull();
  });
});

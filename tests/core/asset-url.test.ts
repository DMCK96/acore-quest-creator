import { describe, expect, it } from 'vitest';
import { assetUrl, parseAssetUrl } from '../../src/core/client/asset-url';
import { worldMapDirectory } from '../../src/core/map/world-maps';

describe('client file addresses', () => {
  it('names the client path a url asks for', () => {
    expect(parseAssetUrl('acqc-wow://file/world/maps/azeroth/azeroth.wdt')).toBe('world/maps/azeroth/azeroth.wdt');
    expect(parseAssetUrl('acqc-wow://file/dbfilesclient/map.dbc?x=1')).toBe('dbfilesclient/map.dbc');
    expect(parseAssetUrl('acqc-wow://file/creature/a%20b/c.m2')).toBe('creature/a b/c.m2');
  });
  it('refuses another scheme, an empty path, a path that climbs out and a broken escape', () => {
    expect(parseAssetUrl('acqc-map://tile/0/6/1/1.png')).toBeNull();
    expect(parseAssetUrl('acqc-wow://file/')).toBeNull();
    expect(parseAssetUrl('acqc-wow://file/../secret')).toBeNull();
    expect(parseAssetUrl('acqc-wow://file/a/..%5Cb')).toBeNull();
    expect(parseAssetUrl('acqc-wow://file/%E0%A4%A')).toBeNull();
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
  });
});

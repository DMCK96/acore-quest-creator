import { describe, expect, it } from 'vitest';
import { parseTeleportLua, TELEPORT_REGIONS } from '../../../src/core/map/teleports';
import bundled from '../../../src/core/map/teleports.json';

const SAMPLE = `
function ReturnTeleportLocations(cont)
if cont  == "EK_N" then
  return {
    ["Alterac Mountains"] = {
      ["Chillwind Point"]                  = ".go xyz 322.373138 -1487.853882 43.720089 0",
      ["Dalaran Ruins"]                    = ".go xyz 386.938 212.299 43.6994 0",
    },
  }
elseif cont == "K" then
  return {
    ["Durotar"] = {
      ["Orgrimmar"] = ".go xyz 1629.36 -4373.39 31.2 1",
    },
  }
 elseif cont == "OT" then
  return {
  ["Other"] = {
    ["Ortell's Hideout"]                                  = ".go xyz  -5314 -2512 484.233185 0",
    ["Deeprun Tram Nessy"]                                = ".go xyz -129.416702 1212.989502 -103.033546 369",
  },
  }
end
end
`;

describe('the teleport spots of an AzerothAdmin table', () => {
  it('reads each spot\'s region, zone, name, map and place', () => {
    expect(parseTeleportLua(SAMPLE)).toEqual([
      { region: 'Eastern Kingdoms', zone: 'Alterac Mountains', name: 'Chillwind Point', map: 0, x: 322.373138, y: -1487.853882, z: 43.720089 },
      { region: 'Eastern Kingdoms', zone: 'Alterac Mountains', name: 'Dalaran Ruins', map: 0, x: 386.938, y: 212.299, z: 43.6994 },
      { region: 'Kalimdor', zone: 'Durotar', name: 'Orgrimmar', map: 1, x: 1629.36, y: -4373.39, z: 31.2 },
      { region: 'Other', zone: 'Other', name: 'Ortell\'s Hideout', map: 0, x: -5314, y: -2512, z: 484.233185 },
      { region: 'Other', zone: 'Other', name: 'Deeprun Tram Nessy', map: 369, x: -129.416702, y: 1212.989502, z: -103.033546 },
    ]);
  });

  it('names each of the table\'s region codes, with Northrend\'s two halves as one', () => {
    expect(TELEPORT_REGIONS.N_A).toBe('Northrend');
    expect(TELEPORT_REGIONS.N_H).toBe('Northrend');
    expect(TELEPORT_REGIONS.EK_S).toBe('Eastern Kingdoms');
    expect(Object.keys(TELEPORT_REGIONS).sort()).toEqual(['BG', 'EK_N', 'EK_S', 'I_EK', 'I_K', 'I_N', 'I_O', 'K', 'N_A', 'N_H', 'OT', 'Ou']);
  });

  it('skips a spot whose place is not numbers, as some typos in the table are', () => {
    const typo = SAMPLE.replace('".go xyz 1629.36 -4373.39 31.2 1"', '".go xyz -1675.317383 -4325,567383 2.787689 1"');
    expect(parseTeleportLua(typo).map((s) => s.name)).not.toContain('Orgrimmar');
  });

  it('skips a line that is not a teleport, and a region code it does not know', () => {
    const odd = SAMPLE.replace('".go xyz 386.938 212.299 43.6994 0"', '".tele dalaran"').replace('cont == "K"', 'cont == "ZZ"');
    expect(parseTeleportLua(odd).map((s) => s.name)).toEqual(['Chillwind Point', 'Ortell\'s Hideout', 'Deeprun Tram Nessy']);
  });
});

describe('the bundled teleport spots', () => {
  it('has every well-formed spot of the AzerothAdmin table, each with a place on a map', () => {
    // 1,307 entries, less 7 the table itself gets wrong (no map, a doubled command, or typos such as 133.010.437)
    expect(bundled.length).toBe(1300);
    for (const spot of bundled) {
      expect(spot.name).not.toBe('');
      expect([spot.x, spot.y, spot.z, spot.map].every(Number.isFinite)).toBe(true);
    }
    expect(bundled.find((s) => s.name === 'Goldshire')).toMatchObject({ region: 'Eastern Kingdoms', map: 0 });
  });
});

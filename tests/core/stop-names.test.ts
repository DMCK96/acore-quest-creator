import { describe, expect, it } from 'vitest';
import { placeName } from '../../src/core/map/stop-names';
import type { TeleportSpot } from '../../src/core/map/teleports';

const spot = (name: string, zone: string, x: number, map = 1): TeleportSpot => ({ region: 'Kalimdor', zone, name, map, x, y: 0, z: 0 });
const spots = [spot('Ratchet', 'The Barrens', 0), spot('[EK]Wetlands/Menethil Harbor', 'Wetlands', 1000, 0), spot('[CT]Orgrimmar', '3 Wind Rider Master', 5000)];

describe('naming a stop', () => {
  it('uses the nearest spot on the same map with its zone', () => {
    expect(placeName({ map: 1, x: 100, y: 0 }, spots, 'Kalimdor')).toBe('Ratchet, The Barrens');
  });
  it('cleans the taxi tag and path, and drops a zone that is not one', () => {
    expect(placeName({ map: 0, x: 1000, y: 0 }, spots, 'Eastern Kingdoms')).toBe('Menethil Harbor, Wetlands');
    expect(placeName({ map: 1, x: 5100, y: 0 }, spots, 'Kalimdor')).toBe('Orgrimmar (Kalimdor)');
  });
  it('falls back to the continent when nothing is near', () => {
    expect(placeName({ map: 1, x: 2500, y: 0 }, spots, 'Kalimdor')).toBe('Kalimdor');
  });
});

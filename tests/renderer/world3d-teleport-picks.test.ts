import { describe, expect, it } from 'vitest';
import teleports from '../../src/core/map/teleports.json';
import type { TeleportSpot } from '../../src/core/map/teleports';
import { QUICK_PICK_NAMES, quickPicks } from '../../src/renderer/world3d/teleport-picks';

const spot = (name: string, map: number): TeleportSpot => ({ name, map, x: 1, y: 2, z: 3, zone: 'Z', region: 'R' }) as TeleportSpot;

describe('well-known places to start from', () => {
  it('are the listed places the teleport list has, in order', () => {
    expect(quickPicks(teleports as TeleportSpot[]).map((s) => s.name)).toEqual([...QUICK_PICK_NAMES]);
  });
  it('leave out names the list does not have, and spots on maps the 3D view does not draw', () => {
    expect(quickPicks([spot('Goldshire', 0), spot('Ironforge', 33), spot('Somewhere', 0)]).map((s) => s.name)).toEqual(['Goldshire']);
  });
  it('take the first spot of a name that is on a drawn map', () => {
    const picks = quickPicks([spot('Goldshire', 33), { ...spot('Goldshire', 0), x: 9 }]);
    expect(picks).toHaveLength(1);
    expect(picks[0]!.x).toBe(9);
  });
});

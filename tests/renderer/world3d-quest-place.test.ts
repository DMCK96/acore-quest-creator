import { describe, expect, it } from 'vitest';
import { questPlace } from '../../src/renderer/world3d/quest-place';

const spawn = (role: string, guid: number, map: number, x: number, entry = 1) => ({ kind: 'creature', guid, entry, name: 'n', map, x, y: 0, z: 0, role }) as any;
const groups = (spawns: any[]) => [{ questId: 1, title: 'Q', spawns, capped: false, cut: 0 }];
const from = { map: 0, x: 0, y: 0, z: 0 };

describe('where a quest is', () => {
  it('prefers the giver, then the ender, then an objective', () => {
    expect(questPlace(groups([spawn('objective', 3, 0, 1), spawn('ender', 2, 0, 1), spawn('giver', 1, 0, 50)]), from)!.guid).toBe(1);
    expect(questPlace(groups([spawn('objective', 3, 0, 1), spawn('ender', 2, 0, 50)]), from)!.guid).toBe(2);
    expect(questPlace(groups([spawn('objective', 3, 0, 1)]), from)!.guid).toBe(3);
  });

  it('takes the spawn on the camera\'s map nearest the camera, else the first', () => {
    expect(questPlace(groups([spawn('giver', 1, 0, 90), spawn('giver', 2, 0, 10), spawn('giver', 3, 1, 1)]), from)!.guid).toBe(2);
    expect(questPlace(groups([spawn('giver', 4, 1, 90), spawn('giver', 5, 1, 10)]), from)!.guid).toBe(4);
  });

  it('narrows to one NPC or object when asked, and gives null when nothing is placed', () => {
    expect(questPlace(groups([spawn('giver', 1, 0, 1, 7), spawn('objective', 2, 0, 5, 8)]), from, { kind: 'creature', entry: 8 })!.guid).toBe(2);
    expect(questPlace(groups([]), from)).toBeNull();
  });
});

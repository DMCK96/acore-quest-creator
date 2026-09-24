import { describe, expect, it } from 'vitest';
import { PRESETS, presetScene } from '../../src/core/scripts/presets';
import { parseGps } from '../../src/core/scripts/gps';
import { sceneSchema } from '../../src/core/scripts/model';

const facts = { questId: 60001, starter: { kind: 'creature', entry: 240 } as const, ender: { kind: 'creature', entry: 241 } as const, firstNpcObjective: 299 };

describe('presets', () => {
  it('every preset builds a valid scene from the quest', () => {
    for (const p of PRESETS) expect(sceneSchema.safeParse(presetScene(p.id, facts, 's1')).success, p.id).toBe(true);
  });
  it('prefills owners from the quest', () => {
    expect(presetScene('acceptSay', facts, 's1').owner).toEqual({ kind: 'creature', entry: 240 });
    expect(presetScene('handInSay', facts, 's1').owner).toEqual({ kind: 'creature', entry: 241 });
    expect(presetScene('useItemCredit', facts, 's1')).toMatchObject({ owner: { kind: 'creature', entry: 299 }, trigger: { kind: 'spellHit', spellId: 0 },
      gates: [{ kind: 'quest', questId: 0, state: 'inLog', negate: false }] });
    expect(presetScene('killCredit', { ...facts, firstNpcObjective: 0 }, 's1').owner).toEqual({ kind: 'creature', entry: 0 });
  });
});

describe('.gps parsing', () => {
  it('reads map and coordinates from the in-game output', () => {
    const text = 'You are outdoors\nMap: 0 (Eastern Kingdoms) Zone: 12 (Elwynn Forest) Area: 9 (Northshire Valley) Phase: 1\nX: -8913.231445 Y: -136.578949 Z: 80.534058 Orientation: 5.123000\ngrid[48,32]cell[5,2] InstanceID: 0';
    expect(parseGps(text)).toEqual({ map: 0, x: -8913.23, y: -136.58, z: 80.53, o: 5.12 });
  });
  it('returns null for text without coordinates', () => expect(parseGps('hello')).toBeNull());
});

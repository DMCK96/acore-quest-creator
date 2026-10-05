import { describe, expect, it } from 'vitest';
import { SPAWN_VIEW_CAP, orderPath, pickPreset, toViewCreature, toViewObject, toViewPreset } from '../../../src/core/db/view-spawns';

const creatureRow = {
  guid: '79970', entry: '197', name: 'Marshal McBride', map: '0',
  position_x: '-8902.59', position_y: '-162.606', position_z: '82.0223', orientation: '1.5',
  display_id: '1953', display_scale: '1.25', wander_distance: '5', MovementType: '1', spawntimesecs: '120',
};

describe('a creature spawn for the 3D view', () => {
  it('carries its place, facing, look and scale', () => {
    const c = toViewCreature(creatureRow, null, [0, 0, 0]);
    expect(c).toEqual({
      guid: 79970, entry: 197, name: 'Marshal McBride', map: 0,
      x: -8902.59, y: -162.606, z: 82.0223, orientation: 1.5,
      displayId: 1953, scale: 1.25, wander: 5, path: null, equipment: [0, 0, 0], own: false, event: null, events: [], removedBy: [], pathId: 0, preset: null, group: null, respawnSecs: 120,
    });
  });

  it('wanders only when its movement is random (1); otherwise it stands', () => {
    expect(toViewCreature({ ...creatureRow, MovementType: '0' }, null, [0, 0, 0]).wander).toBe(0);
    expect(toViewCreature({ ...creatureRow, MovementType: '2' }, null, [0, 0, 0]).wander).toBe(0);
  });

  it('has display 0 and scale 1 when its template has no model row', () => {
    const c = toViewCreature({ ...creatureRow, display_id: null, display_scale: null }, null, [0, 0, 0]);
    expect([c.displayId, c.scale]).toEqual([0, 1]);
  });

  it('keeps the path and weapons it is given', () => {
    const c = toViewCreature(creatureRow, [{ x: 1, y: 2, z: 3 }], [1899, 0, 2551]);
    expect(c.path).toEqual([{ x: 1, y: 2, z: 3 }]);
    expect(c.equipment).toEqual([1899, 0, 2551]);
  });
});

/** How a spawn's event rows come from the database: fields split by \u001e, rows by \u001f */
const FIELD = '\u001e';
const ROW = '\u001f';

describe('a spawn that belongs to a game event', () => {
  it('carries the event it appears for', () => {
    const row = { ...creatureRow, event_entry: '12', event_name: "Hallow's End" };
    expect(toViewCreature(row, null, [0, 0, 0]).event).toEqual({ id: 12, name: "Hallow's End" });
    expect(toViewObject(row).event).toEqual({ id: 12, name: "Hallow's End" });
  });

  it('carries every event it appears for, and every event that takes it away', () => {
    // Each of the spawn's game_event rows: the entry (negative for an event that removes it), then its name
    const list = [`12${FIELD}Hallow's End`, `-26${FIELD}Children's Week`, `7${FIELD}Lunar Festival`].join(ROW);
    const row = { ...creatureRow, event_entry: '7', event_name: 'Lunar Festival', event_list: list };
    for (const spawn of [toViewCreature(row, null, [0, 0, 0]), toViewObject(row)]) {
      expect(spawn.events).toEqual([{ id: 7, name: 'Lunar Festival' }, { id: 12, name: "Hallow's End" }]);
      expect(spawn.removedBy).toEqual([{ id: 26, name: "Children's Week" }]);
      expect(spawn.event).toEqual({ id: 7, name: 'Lunar Festival' });
    }
  });

  it('keeps a name with commas or colons whole', () => {
    const row = { ...creatureRow, event_list: `3${FIELD}Darkmoon Faire: Elwynn, Goldshire` };
    expect(toViewCreature(row, null, [0, 0, 0]).events).toEqual([{ id: 3, name: 'Darkmoon Faire: Elwynn, Goldshire' }]);
  });

  it('has no events and is taken away by none when it has no event rows', () => {
    const c = toViewCreature({ ...creatureRow, event_list: null }, null, [0, 0, 0]);
    expect([c.events, c.removedBy]).toEqual([[], []]);
  });

  it('has none when it has no event row', () => {
    expect(toViewCreature({ ...creatureRow, event_entry: null, event_name: null }, null, [0, 0, 0]).event).toBeNull();
  });
});

describe('a patrol path for the 3D view', () => {
  it('is in point order, however the rows came', () => {
    const rows = [
      { point: '3', position_x: '30', position_y: '0', position_z: '1' },
      { point: '1', position_x: '10', position_y: '0', position_z: '1' },
      { point: '2', position_x: '20', position_y: '0', position_z: '1' },
    ];
    expect(orderPath(rows).map((p) => p.x)).toEqual([10, 20, 30]);
  });
});

describe('an object spawn for the 3D view', () => {
  it('carries its place, rotation, look and size', () => {
    const o = toViewObject({
      guid: '5', entry: '143981', name: 'Mailbox', map: '0',
      position_x: '-9000', position_y: '-100', position_z: '80',
      rotation0: '0', rotation1: '0', rotation2: '0.5', rotation3: '0.8660254',
      display_id: '1949', size: '1.5', spawntimesecs: '45',
    });
    expect(o).toEqual({
      guid: 5, entry: 143981, name: 'Mailbox', map: 0, x: -9000, y: -100, z: 80,
      rotation: [0, 0, 0.5, 0.8660254], displayId: 1949, scale: 1.5, own: false, event: null, events: [], removedBy: [], group: null, respawnSecs: 45,
    });
  });

  it('has an upright rotation and size 1 when the row lacks them', () => {
    const o = toViewObject({ guid: '5', entry: '1', name: null, map: '0', position_x: '0', position_y: '0', position_z: '0', rotation0: null, rotation1: null, rotation2: null, rotation3: null, display_id: null, size: null });
    expect(o.rotation).toEqual([0, 0, 0, 1]);
    expect([o.scale, o.name, o.displayId]).toEqual([1, '', 0]);
    expect(o.respawnSecs).toBe(300);
  });
});

it('caps at 2000 per kind', () => {
  expect(SPAWN_VIEW_CAP).toBe(2000);
});

describe('route data for editing in the 3D view', () => {
  it('carries the route id', () => {
    expect(toViewCreature({ ...creatureRow, path_id: '801' }, null, [0, 0, 0]).pathId).toBe(801);
    expect(toViewCreature(creatureRow, null, [0, 0, 0]).pathId).toBe(0);
  });

  it('carries each point\'s other columns, not its id, point or position', () => {
    const [p] = orderPath([{ id: '801', guid: '5', point: '1', position_x: '1', position_y: '2', position_z: '3', delay: '3000', action: null }]);
    expect(p).toEqual({ x: 1, y: 2, z: 3, carry: { delay: '3000', action: null } });
  });
});

describe('an NPC dressed by a display preset (creature_display_preset)', () => {
  const row = (display: string, over: Record<string, string> = {}) => ({
    entry: '161700', display_id: display, race: '1', gender: '1', class: '1', skin: '1', face: '3', hair: '7', haircolor: '0', facialhair: '3', guild_id: '0',
    item_head: '0', item_shoulders: '0', item_body: '10037', item_chest: '13122', item_waist: '13062', item_legs: '13059', item_feet: '1246',
    item_wrists: '0', item_hands: '0', item_back: '0', item_tabard: '0', ...over,
  });

  it('carries the look the preset gives: race, sex, skin, face, hair, beard and items by slot', () => {
    expect(toViewPreset(row('50'))).toEqual({
      race: 1, sex: 1, skin: 1, face: 3, hairStyle: 7, hairColour: 0, facialHair: 3,
      items: { head: 0, shoulders: 0, body: 10037, chest: 13122, waist: 13062, legs: 13059, feet: 1246, wrists: 0, hands: 0, back: 0, tabard: 0 },
    });
  });

  it('is the preset for the entry and its display, else the entry\'s first, as the server picks it', () => {
    const rows = [row('60', { skin: '6' }), row('50', { skin: '5' }), { ...row('50'), entry: '9' }];
    expect(pickPreset(rows, 161700, 50)!.skin).toBe(5);
    expect(pickPreset(rows, 161700, 999)!.skin).toBe(5);
    expect(pickPreset(rows, 4242, 50)).toBeNull();
  });
});

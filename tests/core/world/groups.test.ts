import { describe, expect, it } from 'vitest';
import { equalShare, isQuestPool, memberKey, validateGroup, type GroupContext, type SpawnGroup } from '../../../src/core/world/groups';

const drake = { type: 'spawn' as const, kind: 'npc' as const, guid: 39203, entry: 32491, chance: 10 };
const vyragosa = { type: 'spawn' as const, kind: 'npc' as const, guid: 39207, entry: 32630, chance: 0 };
const path = (over: Partial<SpawnGroup> = {}): SpawnGroup => ({ id: 32492, name: 'Path 1', map: 571, maxActive: 1, members: [drake, vyragosa], origin: { kind: 'new' }, event: null, ...over });
const context = (over: Partial<GroupContext> = {}): GroupContext => ({
  groups: new Map(), spawnMap: () => 571, objectType: () => 3, groupOfSpawn: () => null, groupOfGroup: () => null,
  quest: () => null, groupOfQuest: () => null, eventExists: () => true, ...over,
});

describe('a spawn group', () => {
  it('the Time-Lost Proto-Drake\'s path group is valid; equal shares split what is left', () => {
    expect(validateGroup(path(), context())).toEqual([]);
    expect(equalShare(path().members)).toBe(90);
    expect(memberKey(drake)).toBe('npc:39203');
    expect(memberKey({ type: 'group', id: 32493, chance: 0 })).toBe('group:32493');
  });

  it('needs members and a sensible number up at once', () => {
    expect(validateGroup(path({ members: [] }), context())).toContain('Add at least one member.');
    expect(validateGroup(path({ maxActive: 3 }), context())).toContain('Up at once must be between 1 and the number of members.');
    expect(validateGroup(path({ maxActive: 0 }), context())).toContain('Up at once must be between 1 and the number of members.');
  });

  it('checks the chances as the server does', () => {
    expect(validateGroup(path({ members: [{ ...drake, chance: 60 }, { ...vyragosa, chance: 50 }] }), context())).toContain('The chances add up to more than 100%.');
    expect(validateGroup(path({ members: [{ ...drake, chance: 60 }, { ...vyragosa, chance: 30 }] }), context())).toContain('With no equal-share member, the chances must add up to 100%.');
    expect(validateGroup(path({ members: [{ ...drake, chance: 60 }, { ...vyragosa, chance: 40 }] }), context())).toEqual([]);
  });

  it('keeps members on its map, in the database, poolable, and in no other group', () => {
    expect(validateGroup(path(), context({ spawnMap: (_k, guid) => (guid === 39207 ? 0 : 571) }))).toContain('Spawn 39207 is on another map.');
    expect(validateGroup(path(), context({ spawnMap: (_k, guid) => (guid === 39207 ? null : 571) }))).toContain('Spawn 39207 is not in the database any more.');
    const mailbox = { type: 'spawn' as const, kind: 'object' as const, guid: 5, entry: 143981, chance: 0 };
    expect(validateGroup(path({ members: [drake, mailbox] }), context({ objectType: () => 19 }))).toContain(
      'Spawn 5 cannot be pooled: only chests (herbs and veins are chests), usable objects and fishing schools can be.');
    expect(validateGroup(path(), context({ groupOfSpawn: (_k, guid) => (guid === 39203 ? 7000 : null) }))).toContain('Spawn 39203 is already in group 7000.');
    expect(validateGroup(path(), context({ groupOfSpawn: () => 32492 }))).toEqual([]);
  });

  it('a group of groups: no group inside itself, none taken from another, all on one map', () => {
    const mother = path({ id: 32491, name: 'Drake', members: [{ type: 'group', id: 32492, chance: 0 }, { type: 'group', id: 32493, chance: 0 }] });
    const groups = new Map([[32492, path()], [32493, path({ id: 32493 })]]);
    expect(validateGroup(mother, context({ groups }))).toEqual([]);
    const loop = new Map([[32492, path({ members: [{ type: 'group', id: 32491, chance: 0 }] })], [32493, path({ id: 32493 })]]);
    expect(validateGroup(mother, context({ groups: loop }))).toContain('A group cannot contain itself.');
    expect(validateGroup(mother, context({ groups, groupOfGroup: (id) => (id === 32493 ? 9 : null) }))).toContain('Group 32493 is already inside group 9.');
    const away = new Map([[32492, path()], [32493, path({ id: 32493, map: 0 })]]);
    expect(validateGroup(mother, context({ groups: away }))).toContain('Group 32493 is on another map.');
  });

  it('a member group that is gone, or deleted here, is named', () => {
    const mother = path({ id: 32491, name: 'Drake', members: [{ type: 'group', id: 32492, chance: 0 }, { type: 'group', id: 32493, chance: 0 }] });
    expect(validateGroup(mother, context({ groups: new Map([[32492, path()]]) }))).toContain('Group 32493 is not there any more.');
    const deleted = new Map([[32492, path()], [32493, path({ id: 32493, removed: true })]]);
    expect(validateGroup(mother, context({ groups: deleted }))).toEqual(['Group 32493 is not there any more.']);
  });
});

describe('quest rotations and events', () => {
  const daily = (questId: number) => ({ type: 'quest' as const, questId });
  const quests = new Map([
    [60001, { title: 'Wolves', daily: true, weekly: false, hasGiver: true }],
    [60002, { title: 'Boars', daily: true, weekly: false, hasGiver: true }],
    [60003, { title: 'Raid', daily: false, weekly: true, hasGiver: true }],
    [60004, { title: 'Plain', daily: false, weekly: false, hasGiver: true }],
    [60005, { title: 'Lonely', daily: true, weekly: false, hasGiver: false }],
  ]);
  const ctx = (over = {}) => context({ quest: (id: number) => quests.get(id) ?? null, ...over });
  const rotation = (over = {}) => path({ id: 900010, name: 'Dailies', map: 0, members: [daily(60001), daily(60002)], ...over });

  it('a rotation of daily quests with givers is valid, and is a quest pool', () => {
    expect(validateGroup(rotation(), ctx())).toEqual([]);
    expect(isQuestPool(rotation())).toBe(true);
    expect(memberKey(daily(60001))).toBe('quest:60001');
  });

  it('refuses mixed members, mixed daily and weekly, non-repeating quests and quests nobody offers', () => {
    expect(validateGroup(rotation({ members: [daily(60001), drake] }), ctx())).toContain('A spawn group holds quests or spawns, not both.');
    expect(validateGroup(rotation({ members: [daily(60001), daily(60003)] }), ctx())).toContain('Daily and weekly quests cannot share a rotation.');
    expect(validateGroup(rotation({ members: [daily(60001), daily(60004)] }), ctx())).toContain('Plain is not a daily or weekly quest.');
    expect(validateGroup(rotation({ members: [daily(60001), daily(60005)] }), ctx())).toContain('Lonely has no giver, so it is never offered.');
  });

  it('a quest is in one rotation; a rotation is not nested and follows no event', () => {
    expect(validateGroup(rotation(), ctx({ groupOfQuest: (id: number) => (id === 60002 ? 7 : null) }))).toContain('Boars is already in rotation 7.');
    expect(validateGroup(rotation(), ctx({ groupOfGroup: () => 5 }))).toContain('A quest rotation cannot be inside another group.');
    expect(validateGroup(rotation({ event: { id: 4, during: true } }), ctx())).toContain('A quest rotation cannot follow an event.');
  });

  it('a quest with both daily and weekly bits counts as daily, and an out-of-range count names the offered-each-reset rule', () => {
    const both = new Map([[60001, { title: 'Both', daily: true, weekly: true, hasGiver: true }], [60002, { title: 'Boars', daily: true, weekly: false, hasGiver: true }]]);
    const c = context({ quest: (id: number) => both.get(id) ?? null });
    expect(validateGroup(rotation(), c)).toEqual([]);
    expect(validateGroup(rotation({ maxActive: 3 }), c)).toEqual(['Offered each reset must be between 1 and the number of quests.']);
    expect(validateGroup(path({ maxActive: 3 }), c)).toContain('Up at once must be between 1 and the number of members.');
  });

  it('a rotation needs at least two quests', () => {
    expect(validateGroup(rotation({ members: [daily(60001)] }), ctx())).toContain('A rotation needs at least two quests.');
    expect(validateGroup(rotation(), ctx())).not.toContain('A rotation needs at least two quests.');
    expect(validateGroup(path(), ctx())).not.toContain('A rotation needs at least two quests.');
  });

  it('events: top-level spawn groups only, and the event must exist', () => {
    expect(validateGroup(path({ event: { id: 4, during: true } }), ctx())).toEqual([]);
    expect(validateGroup(path({ event: { id: 4, during: false } }), ctx({ groupOfGroup: () => 32491 }))).toContain('Only a group that is not inside another can follow an event.');
    expect(validateGroup(path({ event: { id: 999, during: true } }), ctx({ eventExists: () => false }))).toContain('Event 999 is not in the database.');
  });

  it('names the other rotation when its name is known, and unknown quests by id; equal shares ignore quests', () => {
    const groups = new Map([[7, rotation({ id: 7, name: 'Fishing dailies', members: [daily(60002)] })]]);
    expect(validateGroup(rotation(), ctx({ groups, groupOfQuest: (id: number) => (id === 60002 ? 7 : null) }))).toContain('Boars is already in rotation Fishing dailies.');
    expect(validateGroup(rotation({ members: [daily(60001), daily(61234)] }), ctx())).toContain('Quest 61234 is not in the project or the database.');
    expect(equalShare([...path().members, daily(60001)])).toBe(90);
    expect(validateGroup(rotation({ members: [daily(60001), { type: 'group', id: 32492, chance: 0 }] }), ctx({ groups: new Map([[32492, path()]]) }))).toContain('A spawn group holds quests or spawns, not both.');
  });

  it('nested groups: a member that follows an event or is a rotation is refused, from the parent side too', () => {
    const inner = (over = {}) => path({ id: 32493, name: 'Inner', members: [drake], ...over });
    const parent = path({ members: [{ type: 'group', id: 32493, chance: 0 }] });
    const withChild = (child: SpawnGroup) => ctx({ groups: new Map([[32493, child]]) });
    expect(validateGroup(parent, withChild(inner()))).toEqual([]);
    expect(validateGroup(parent, withChild(inner({ event: { id: 4, during: true } })))).toContain('Only a group that is not inside another can follow an event.');
    expect(validateGroup(parent, withChild(inner({ map: 0, members: [daily(60001), daily(60002)] })))).toContain('A quest rotation cannot be inside another group.');
  });
});

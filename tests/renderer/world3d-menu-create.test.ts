import { describe, expect, it } from 'vitest';
import { buildMenu, type MenuContext, type MenuItem, type MenuSpawn, type MenuTarget } from '../../src/renderer/world3d/menu/model';

const at = { x: 1, y: 2, z: 3 };
// `own`: a spawn of one of the project's own NPCs or objects
const spawn = (over: Partial<MenuSpawn> = {}): MenuSpawn => ({ kind: 'creature', guid: 6000001, entry: 12000001, name: 'Hela', own: true, added: false, pathId: 0, wander: 0, map: 0,
  placement: { x: 1, y: 2, z: 3, orientation: 0, rotation: null }, ...over });
const context = (over: Partial<MenuContext> = {}): MenuContext => ({ map: 0, connected: true, clipboard: { count: 0, blocked: null }, placing: false, drawing: null, quest: null, project: true, marked: false, lootable: () => null, ...over });
const ground: MenuTarget = { ground: at, hit: null, selection: [] };
const on = (s: MenuSpawn): MenuTarget => ({ ground: at, hit: { type: 'spawn', spawn: s }, selection: [s] });
const flat = (groups: ReturnType<typeof buildMenu>): MenuItem[] => groups.flatMap((g) => g.items.flatMap((i) => [i, ...(i.children ?? [])]));
const item = (groups: ReturnType<typeof buildMenu>, label: string) => flat(groups).find((i) => i.label === label);
const quest = { id: 60001, title: 'Wolves', roles: { givers: [], enders: [], objectives: [null, null, null, null] }, entities: [], chained: false };

describe('creating from the menu', () => {
  it('offers a new NPC and a new object on the ground, after placing', () => {
    const world = buildMenu(ground, context()).find((g) => g.id === 'world')!.items.map((i) => i.label);
    expect(world.slice(0, 4)).toEqual(['Place NPC here…', 'Place object here…', 'New NPC here…', 'New object here…']);
    expect(item(buildMenu(ground, context()), 'New NPC here…')!.action).toEqual({ kind: 'newEntity', what: 'creature', at, forQuest: false });
    expect(item(buildMenu(ground, context()), 'New object here…')!.action).toEqual({ kind: 'newEntity', what: 'object', at, forQuest: false });
  });

  it('needs the ground and the database', () => {
    expect(item(buildMenu({ ground: null, hit: null, selection: [] }, context()), 'New NPC here…')!.disabledReason).toBe('Right-click the ground');
    expect(item(buildMenu(ground, context({ connected: false })), 'New object here…')!.disabledReason).toBe('Needs the world database');
  });

  it('with a quest open, offers new quest NPCs and objects', () => {
    const groups = buildMenu(ground, context({ quest }));
    expect(item(groups, 'New quest NPC here…')!.action).toEqual({ kind: 'newEntity', what: 'creature', at, forQuest: true });
    expect(item(groups, 'New quest object here…')!.action).toEqual({ kind: 'newEntity', what: 'object', at, forQuest: true });
    expect(item(buildMenu(ground, context()), 'New quest NPC here…')).toBeUndefined();
  });

  it('a project spawn can be edited and removed; a database one cannot', () => {
    expect(item(buildMenu(on(spawn()), context()), 'Edit NPC…')!.action).toEqual({ kind: 'editEntity', spawn: spawn() });
    expect(item(buildMenu(on(spawn()), context()), 'Remove')!.action).toEqual({ kind: 'remove', spawn: spawn() });
    expect(item(buildMenu(on(spawn({ own: false })), context()), 'Edit NPC…')).toBeUndefined();
    expect(item(buildMenu(on(spawn({ own: false })), context()), 'Remove')).toBeUndefined();
  });

  it('a project object offers Make lootable, or Stop being lootable when it is', () => {
    const crate = spawn({ kind: 'object', entry: 9100001, name: 'Crate', guid: 7000001 });
    expect(item(buildMenu(on(crate), context({ lootable: () => false })), 'Make lootable…')!.action).toEqual({ kind: 'setLootable', spawn: crate, on: true });
    expect(item(buildMenu(on(crate), context({ lootable: () => true })), 'Stop being lootable')!.action).toEqual({ kind: 'setLootable', spawn: crate, on: false });
    expect(item(buildMenu(on(crate), context({ lootable: () => false })), 'Edit object…')).toBeTruthy();
    expect(item(buildMenu(on(spawn({ kind: 'object', own: false })), context({ lootable: () => null })), 'Make lootable…')).toBeUndefined();
  });
});

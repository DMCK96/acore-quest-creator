// tests/renderer/world3d-menu-sections.test.ts
import { describe, expect, it } from 'vitest';
import { buildMenu, type MenuSection } from '../../src/renderer/world3d/menu/section';
import { SECTIONS } from '../../src/renderer/world3d/menu/sections';
import { subjectOf, type MenuSubject } from '../../src/renderer/world3d/menu/subject';
import type { MenuContext, MenuItem, MenuSpawn, MenuTarget } from '../../src/renderer/world3d/menu/model';
import { EMPTY_ENTITIES, newNpc, newObject, type ProjectEntities } from '../../src/core/entities/model';

const at = { x: 1, y: 2, z: 3 };
const npc = (over: Partial<MenuSpawn> = {}): MenuSpawn => ({ kind: 'creature', guid: 80330, entry: 1423, name: 'Guard', own: false, added: false, pathId: 0, wander: 0, map: 0, respawnSecs: 300,
  placement: { x: 1, y: 2, z: 3, orientation: 0, rotation: null }, ...over });
const crate = (over: Partial<MenuSpawn> = {}): MenuSpawn => npc({ kind: 'object', guid: 5, entry: 143981, name: 'Crate', ...over });
const hela = npc({ guid: 6000001, entry: 12000001, name: 'Hela', own: true });
const chest = crate({ guid: 7000001, entry: 9100001, own: true });
const store: ProjectEntities = { ...EMPTY_ENTITIES, npcs: [{ ...newNpc(12000001), name: 'Hela' }], objects: [{ ...newObject(9100001), name: 'Crate' }] };
const context = (over: Partial<MenuContext> = {}): MenuContext => ({ map: 0, connected: true, clipboard: { count: 0, blocked: null }, placing: false, drawing: null, quest: null, project: true, marked: false, ...over });
const ground = (selection: MenuSpawn[] = []): MenuSubject => subjectOf({ ground: at, hit: null, selection }, store);
const sky: MenuSubject = subjectOf({ ground: null, hit: null, selection: [] }, store);
const on = (spawn: MenuSpawn, s: ProjectEntities = store): MenuSubject => subjectOf({ ground: at, hit: { type: 'spawn', spawn }, selection: [spawn] } as MenuTarget, s);
const quest = { id: 60001, title: 'Wolves', roles: { givers: [{ kind: 'creature' as const, id: 1423 }], enders: [], objectives: [null, null, null, null] }, chained: true };

const all = (items: MenuItem[]): MenuItem[] => items.flatMap((i) => [i, ...all(i.children ?? [])]);
const flat = (groups: ReturnType<typeof buildMenu>): MenuItem[] => all(groups.flatMap((g) => g.items));
const item = (groups: ReturnType<typeof buildMenu>, label: string) => flat(groups).find((i) => i.label === label);
const labels = (groups: ReturnType<typeof buildMenu>) => groups.map((g) => [g.id, g.items.map((i) => i.label)]);

describe('the builder', () => {
  it('registers the sections in the spec order', () => {
    expect(SECTIONS.map((s) => s.id)).toEqual(['busy', 'create', 'edit', 'loot', 'clipboard', 'coordinates', 'respawn', 'remove', 'movement', 'quest-parts', 'quest-spawns']);
  });

  it('runs only sections that apply, joins those of one group, and drops empty groups', () => {
    const always: MenuSection = { id: 'a', group: 'world', appliesTo: (s): s is MenuSubject => true, items: () => [{ id: 'one', label: 'One' }] };
    const never: MenuSection = { id: 'b', group: 'quest', appliesTo: (s): s is MenuSubject => false, items: () => [{ id: 'two', label: 'Two' }] };
    const empty: MenuSection = { id: 'c', group: 'movement', appliesTo: (s): s is MenuSubject => true, items: () => [] };
    const also: MenuSection = { id: 'd', group: 'world', appliesTo: (s): s is MenuSubject => true, items: () => [{ id: 'three', label: 'Three' }] };
    expect(labels(buildMenu(ground(), context(), [always, never, empty, also]))).toEqual([['world', ['One', 'Three']]]);
  });

  it('while a path is drawn, offers only the busy group', () => {
    const groups = buildMenu(ground([npc()]), context({ drawing: { guid: 80330, points: 2 } }));
    expect(labels(groups)).toEqual([['busy', ['Finish path', 'Undo last point', 'Cancel path']]]);
  });

  it('while placing, Stop placing comes first', () => {
    expect(buildMenu(ground(), context({ placing: true }))[0]).toEqual({ id: 'busy', items: [{ id: 'stop-placing', label: 'Stop placing', action: { kind: 'stopPlacing' } }] });
  });
});

describe('the ground', () => {
  it('offers placing, creating, paste and coordinates, and no quest group without a quest', () => {
    expect(labels(buildMenu(ground(), context()))).toEqual([
      ['world', ['Place NPC here…', 'Place object here…', 'New NPC here…', 'New object here…', 'Paste here', 'Copy coordinates']],
    ]);
    expect(item(buildMenu(ground(), context()), 'New NPC here…')!.action).toEqual({ kind: 'newEntity', what: 'creature', at });
    expect(item(buildMenu(ground(), context()), 'Paste here')!.disabledReason).toBe('Copy something first');
  });

  it('pastes what was copied, with a count', () => {
    expect(item(buildMenu(ground(), context({ clipboard: { count: 3, blocked: null } })), 'Paste here (3)')!.action).toEqual({ kind: 'paste', at });
  });

  it('the sky disables what needs the ground', () => {
    const groups = buildMenu(sky, context({ clipboard: { count: 1, blocked: null } }));
    for (const label of ['Place NPC here…', 'Place object here…', 'New NPC here…', 'New object here…', 'Paste here (1)', 'Copy coordinates']) {
      expect(item(groups, label)!.disabledReason).toBe('Right-click the ground');
    }
  });

  it('offline, placing and creating say they need the database', () => {
    const groups = buildMenu(ground(), context({ connected: false }));
    expect(item(groups, 'Place NPC here…')!.disabledReason).toBe('Needs the world database');
    expect(item(groups, 'New object here…')!.disabledReason).toBe('Needs the world database');
  });

  it('with one NPC selected and no path, offers to start its path here', () => {
    expect(item(buildMenu(ground([npc()]), context()), 'Start path here')!.action).toEqual({ kind: 'startPath', spawn: npc(), at });
    expect(item(buildMenu(ground([npc({ pathId: 801 })]), context()), 'Start path here')).toBeUndefined();
    expect(item(buildMenu(ground([npc(), npc({ guid: 2 })]), context()), 'Start path here')).toBeUndefined();
    expect(item(buildMenu(ground([npc()]), context({ connected: false })), 'Start path here')!.disabledReason).toBe('Needs the world database');
  });

  it('with a quest open: its spawns to show and hide, and nothing quest-flavoured to create', () => {
    expect(labels(buildMenu(ground(), context({ quest }))).find(([id]) => id === 'quest')).toEqual(['quest', ['Show quest spawns', 'Show chain spawns']]);
    expect(item(buildMenu(ground(), context({ quest: { ...quest, chained: false } })), 'Show chain spawns')).toBeUndefined();
    expect(item(buildMenu(ground(), context({ quest, marked: true })), 'Hide quest spawns')!.action).toEqual({ kind: 'hideSpawns' });
  });
});

describe('a spawn', () => {
  it('a database NPC: copy, duplicate, coordinates; no edit, loot or remove', () => {
    const world = buildMenu(on(npc()), context()).find((g) => g.id === 'world')!;
    expect(world.items.map((i) => i.label)).toEqual(['Copy', 'Duplicate', 'Copy coordinates', 'Respawn time…']);
  });

  it('a project NPC: edit first, and remove last', () => {
    const world = buildMenu(on(hela), context()).find((g) => g.id === 'world')!;
    expect(world.items.map((i) => i.label)).toEqual(['Edit NPC…', 'Copy', 'Duplicate', 'Copy coordinates', 'Respawn time…', 'Remove']);
    expect(item(buildMenu(on(hela), context()), 'Edit NPC…')!.action).toEqual({ kind: 'editEntity', spawn: hela });
  });

  it('a spawn placed in the view can be removed although its NPC is the database\'s', () => {
    expect(item(buildMenu(on(npc({ added: true })), context()), 'Remove')!.action).toEqual({ kind: 'remove', spawn: npc({ added: true }) });
  });

  it('copies a whole selection and names how many', () => {
    const groups = buildMenu(subjectOf({ ground: at, hit: { type: 'spawn', spawn: npc() }, selection: [npc(), crate()] }, store), context());
    expect(item(groups, 'Copy 2')!.action).toEqual({ kind: 'copy' });
    expect(item(groups, 'Duplicate 2')!.action).toEqual({ kind: 'duplicate' });
  });

  it('a project object offers Make lootable, or Stop being lootable when it is a chest', () => {
    expect(item(buildMenu(on(chest), context()), 'Make lootable…')!.action).toEqual({ kind: 'setLootable', spawn: chest, on: true });
    const chestStore = { ...store, objects: [{ ...store.objects[0]!, type: 'chest' as const }] };
    expect(item(buildMenu(on(chest, chestStore), context()), 'Stop being lootable')!.action).toEqual({ kind: 'setLootable', spawn: chest, on: false });
    expect(item(buildMenu(on(crate()), context()), 'Make lootable…')).toBeUndefined();
  });

  it('an NPC: wander, and remove path only when it walks one; an object has no movement', () => {
    expect(item(buildMenu(on(npc()), context()), 'Change wander distance…')!.action).toEqual({ kind: 'wander', spawn: npc() });
    expect(item(buildMenu(on(npc()), context()), 'Remove path')).toBeUndefined();
    const walking = buildMenu(on(npc({ pathId: 801 })), context());
    expect(item(walking, 'Change wander distance…')!.disabledReason).toBe('Walks a path: remove the path first');
    expect(item(walking, 'Remove path')!.action).toEqual({ kind: 'removePath', spawn: npc({ pathId: 801 }) });
    expect(buildMenu(on(crate()), context()).map((g) => g.id)).not.toContain('movement');
  });

  it('offline: a database NPC\'s movement needs the database, a project NPC\'s does not', () => {
    expect(item(buildMenu(on(npc()), context({ connected: false })), 'Change wander distance…')!.disabledReason).toBe('Needs the world database');
    expect(item(buildMenu(on(hela), context({ connected: false })), 'Change wander distance…')!.action).toBeDefined();
  });

  it('Quests ▸ sets or removes the spawn\'s parts in the open quest and starts quests from an NPC', () => {
    const groups = buildMenu(on(npc()), context({ quest }));
    expect(groups.find((g) => g.id === 'quest')!.items.map((i) => [i.label, i.children?.map((c) => c.label)])).toEqual([
      ['Quests', ['Remove as quest giver', 'Set as quest ender', 'Add as kill objective', 'Start a new quest from this NPC', 'Start the next quest in this chain']],
    ]);
    expect(item(groups, 'Set as quest ender')!.action).toEqual({ kind: 'toggleRole', role: 'ender', spawn: npc(), on: true });
    expect(item(buildMenu(on(crate()), context({ quest })), 'Add as use objective')).toBeDefined();
    const full = { ...quest, roles: { ...quest.roles, objectives: [1, 2, 3, 4].map((id) => ({ kind: 'creature' as const, id })) } };
    expect(item(buildMenu(on(npc()), context({ quest: full })), 'Add as kill objective')!.disabledReason).toBe('All four objectives are in use');
  });

  it('without a quest an NPC still starts one; an object has no Quests submenu; no project, none at all', () => {
    expect(item(buildMenu(on(npc()), context()), 'Start a new quest from this NPC')!.action).toEqual({ kind: 'newQuest', spawn: npc(), after: false });
    expect(item(buildMenu(on(npc()), context()), 'Start the next quest in this chain')).toBeUndefined();
    expect(buildMenu(on(crate()), context()).map((g) => g.id)).not.toContain('quest');
    expect(item(buildMenu(on(npc()), context({ project: false })), 'Quests')).toBeUndefined();
  });
});

describe('respawn time', () => {
  it('on a spawn, or a selection, opens the respawn dialog for them', () => {
    expect(item(buildMenu(on(npc()), context()), 'Respawn time…')!.action).toEqual({ kind: 'respawn', spawns: [npc()] });
    const both = subjectOf({ ground: at, hit: { type: 'spawn', spawn: npc() }, selection: [npc(), crate()] }, store);
    expect(item(buildMenu(both, context()), 'Respawn time of 2 spawns…')!.action).toEqual({ kind: 'respawn', spawns: [npc(), crate()] });
    expect(item(buildMenu(ground([npc()]), context()), 'Respawn time…')!.action).toEqual({ kind: 'respawn', spawns: [npc()] });
  });

  it('offline, a database spawn needs the database; a project one does not', () => {
    expect(item(buildMenu(on(npc()), context({ connected: false })), 'Respawn time…')!.disabledReason).toBe('Needs the world database');
    expect(item(buildMenu(on(hela), context({ connected: false })), 'Respawn time…')!.action).toBeDefined();
  });
});

describe('a route point', () => {
  it('copies its coordinates, or says to right-click the ground', () => {
    const point = (ground: typeof at | null) => subjectOf({ ground, hit: { type: 'point', guid: 80330, index: 1 }, selection: [] }, store);
    expect(labels(buildMenu(point(at), context()))).toEqual([['world', ['Copy coordinates']]]);
    expect(item(buildMenu(point(null), context()), 'Copy coordinates')!.disabledReason).toBe('Right-click the ground');
  });
});

describe('cases carried over from the old builders', () => {
  it('a paste blocked here says why', () => {
    expect(item(buildMenu(ground(), context({ clipboard: { count: 1, blocked: 'Not on this map' } })), 'Paste here (1)')!.disabledReason).toBe('Not on this map');
  });

  it('a project object is edited as an object', () => {
    expect(item(buildMenu(on(chest), context()), 'Edit object…')!.action).toEqual({ kind: 'editEntity', spawn: chest });
  });

  it('chain spawns are shown by scope, and the next quest in the chain starts after this one', () => {
    expect(item(buildMenu(ground(), context({ quest })), 'Show chain spawns')!.action).toEqual({ kind: 'showSpawns', scope: 'chain' });
    expect(item(buildMenu(on(npc()), context({ quest })), 'Start the next quest in this chain')!.action).toEqual({ kind: 'newQuest', spawn: npc(), after: true });
  });
});

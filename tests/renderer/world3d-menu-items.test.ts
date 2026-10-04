import { describe, expect, it } from 'vitest';
import { buildMenu, type MenuContext, type MenuItem, type MenuSpawn, type MenuTarget } from '../../src/renderer/world3d/menu/model';

const at = { x: 1, y: 2, z: 3 };
const npc = (over: Partial<MenuSpawn> = {}): MenuSpawn => ({ kind: 'creature', guid: 80330, entry: 1423, name: 'Guard', own: false, added: false, pathId: 0, wander: 0, map: 0,
  placement: { x: 1, y: 2, z: 3, orientation: 0, rotation: null }, ...over });
const crate = (over: Partial<MenuSpawn> = {}): MenuSpawn => npc({ kind: 'object', guid: 5, entry: 143981, name: 'Crate', ...over });
const context = (over: Partial<MenuContext> = {}): MenuContext => ({ map: 0, connected: true, clipboard: { count: 0, blocked: null }, placing: false, drawing: null, quest: null, project: true, marked: false, ...over });
const ground = (selection: MenuSpawn[] = []): MenuTarget => ({ ground: at, hit: null, selection });
const onSpawn = (spawn: MenuSpawn): MenuTarget => ({ ground: at, hit: { type: 'spawn', spawn }, selection: [spawn] });
const quest = { id: 60001, title: 'Wolves', roles: { givers: [{ kind: 'creature' as const, id: 1423 }], enders: [], objectives: [null, null, null, null] },
  entities: [{ kind: 'creature' as const, entry: 12000001, name: 'Hela', own: true }, { kind: 'creature' as const, entry: 1423, name: 'Guard', own: false }], chained: true };

const flat = (groups: ReturnType<typeof buildMenu>): MenuItem[] => groups.flatMap((g) => g.items);
const item = (groups: ReturnType<typeof buildMenu>, label: string) => flat(groups).find((i) => i.label === label);
const labels = (groups: ReturnType<typeof buildMenu>) => groups.map((g) => [g.id, g.items.map((i) => i.label)]);

describe('the menu on the ground', () => {
  it('offers placing, paste and coordinates; a quest group only says to open a quest', () => {
    expect(labels(buildMenu(ground(), context()))).toEqual([
      ['world', ['Place NPC here…', 'Place object here…', 'Paste here', 'Copy coordinates']],
      ['quest', ['Spawn quest NPC here']],
    ]);
    expect(item(buildMenu(ground(), context()), 'Paste here')!.disabledReason).toBe('Copy something first');
    expect(item(buildMenu(ground(), context()), 'Spawn quest NPC here')!.disabledReason).toBe('Open a quest first');
  });

  it('pastes what was copied at the clicked point, or says why it cannot', () => {
    expect(item(buildMenu(ground(), context({ clipboard: { count: 3, blocked: null } })), 'Paste here (3)')!.action).toEqual({ kind: 'paste', at });
    expect(item(buildMenu(ground(), context({ clipboard: { count: 1, blocked: 'Open Wolves to paste its NPC' } })), 'Paste here (1)')!.disabledReason).toBe('Open Wolves to paste its NPC');
  });

  it('a click on the sky disables what needs the ground', () => {
    const sky = buildMenu({ ground: null, hit: null, selection: [] }, context({ clipboard: { count: 1, blocked: null } }));
    for (const label of ['Place NPC here…', 'Place object here…', 'Paste here (1)', 'Copy coordinates']) expect(item(sky, label)!.disabledReason).toBe('Right-click the ground');
  });

  it('without the world database, world placing is disabled', () => {
    expect(item(buildMenu(ground(), context({ connected: false })), 'Place NPC here…')!.disabledReason).toBe('Needs the world database');
  });

  it('with one NPC selected and no route, offers to start its path here', () => {
    expect(item(buildMenu(ground([npc()]), context()), 'Start path here')!.action).toEqual({ kind: 'startPath', spawn: npc(), at });
    expect(item(buildMenu(ground([npc({ pathId: 801 })]), context()), 'Start path here')).toBeUndefined();
    expect(item(buildMenu(ground([npc(), npc({ guid: 2 })]), context()), 'Start path here')).toBeUndefined();
  });

  it('with a quest open, lists its NPCs and objects to spawn here, own first', () => {
    const spawnHere = item(buildMenu(ground(), context({ quest })), 'Spawn quest NPC here')!;
    expect(spawnHere.children!.map((c) => c.label)).toEqual(['Hela', 'Guard']);
    expect(spawnHere.children![0]!.action).toEqual({ kind: 'spawnQuestEntity', target: quest.entities[0], at });
  });

  it('shows and hides quest spawns', () => {
    expect(item(buildMenu(ground(), context({ quest })), 'Show chain spawns')!.action).toEqual({ kind: 'showSpawns', scope: 'chain' });
    expect(item(buildMenu(ground(), context({ quest: { ...quest, chained: false } })), 'Show chain spawns')).toBeUndefined();
    expect(item(buildMenu(ground(), context({ quest, marked: true })), 'Hide quest spawns')!.action).toEqual({ kind: 'hideSpawns' });
  });
});

describe('the menu on a spawn', () => {
  it('copies, duplicates, copies coordinates; removes only a placed one', () => {
    const groups = buildMenu(onSpawn(npc()), context());
    expect(groups[0]!.items.map((i) => i.label)).toEqual(['Copy', 'Duplicate', 'Copy coordinates']);
    expect(item(buildMenu(onSpawn(npc({ added: true })), context()), 'Remove')!.action).toEqual({ kind: 'remove', spawn: npc({ added: true }) });
  });

  it('copies a whole selection, and names how many', () => {
    const groups = buildMenu({ ground: at, hit: { type: 'spawn', spawn: npc() }, selection: [npc(), crate()] }, context());
    expect(item(groups, 'Copy 2')!.action).toEqual({ kind: 'copy' });
    expect(item(groups, 'Duplicate 2')!.action).toEqual({ kind: 'duplicate' });
  });

  it('an NPC: wander, and remove path only when it walks one', () => {
    expect(item(buildMenu(onSpawn(npc()), context()), 'Change wander distance…')!.action).toEqual({ kind: 'wander', spawn: npc() });
    expect(item(buildMenu(onSpawn(npc()), context()), 'Remove path')).toBeUndefined();
    const walking = buildMenu(onSpawn(npc({ pathId: 801 })), context());
    expect(item(walking, 'Change wander distance…')!.disabledReason).toBe('Walks a path: remove the path first');
    expect(item(walking, 'Remove path')!.action).toEqual({ kind: 'removePath', spawn: npc({ pathId: 801 }) });
  });

  it('an object has no movement group', () => {
    expect(buildMenu(onSpawn(crate()), context()).map((g) => g.id)).not.toContain('movement');
  });

  it('with a quest open: roles as checks, objective as kill or use', () => {
    const groups = buildMenu(onSpawn(npc()), context({ quest }));
    expect(item(groups, 'Quest giver')).toMatchObject({ checked: true, action: { kind: 'toggleRole', role: 'giver', on: false } });
    expect(item(groups, 'Quest ender')).toMatchObject({ checked: false, action: { kind: 'toggleRole', role: 'ender', on: true } });
    expect(item(groups, 'Kill objective')).toMatchObject({ checked: false });
    expect(item(buildMenu(onSpawn(crate()), context({ quest })), 'Use objective')).toBeDefined();
    const full = { ...quest, roles: { ...quest.roles, objectives: [1, 2, 3, 4].map((id) => ({ kind: 'creature' as const, id })) } };
    expect(item(buildMenu(onSpawn(npc()), context({ quest: full })), 'Kill objective')!.disabledReason).toBe('All four objectives are in use');
  });

  it('starts a new quest from an NPC, and the next in the chain when a quest is open', () => {
    expect(item(buildMenu(onSpawn(npc()), context()), 'Start a new quest from this NPC')!.action).toEqual({ kind: 'newQuest', spawn: npc(), after: false });
    expect(item(buildMenu(onSpawn(npc()), context()), 'Start the next quest in this chain')).toBeUndefined();
    expect(item(buildMenu(onSpawn(npc()), context({ quest })), 'Start the next quest in this chain')!.action).toEqual({ kind: 'newQuest', spawn: npc(), after: true });
    expect(item(buildMenu(onSpawn(npc()), context({ project: false })), 'Start a new quest from this NPC')).toBeUndefined();
  });
});

describe('the menu while busy', () => {
  it('placing: Stop placing first', () => {
    expect(buildMenu(ground(), context({ placing: true }))[0]).toEqual({ id: 'state', items: [{ id: 'stop-placing', label: 'Stop placing', action: { kind: 'stopPlacing' } }] });
  });

  it('drawing a path: finish, undo and cancel, and nothing else', () => {
    const groups = buildMenu(ground([npc()]), context({ drawing: { guid: 80330, points: 2 } }));
    expect(groups.map((g) => g.id)).toEqual(['state']);
    expect(groups[0]!.items.map((i) => i.label)).toEqual(['Finish path', 'Undo last point', 'Cancel path']);
  });

  it('gives two quest NPCs of the same name items of their own', () => {
    const twins = { ...quest, entities: [{ kind: 'creature' as const, entry: 1, name: 'Wolf', own: true }, { kind: 'creature' as const, entry: 2, name: 'Wolf', own: false }] };
    const children = item(buildMenu(ground(), context({ quest: twins })), 'Spawn quest NPC here')!.children!;
    expect(new Set(children.map((c) => c.id)).size).toBe(2);
  });

  it('without the world database, a world NPC\u2019s movement items say so; a quest\u2019s own NPC keeps them', () => {
    const offline = context({ connected: false });
    expect(item(buildMenu(onSpawn(npc()), offline), 'Change wander distance…')!.disabledReason).toBe('Needs the world database');
    expect(item(buildMenu(ground([npc()]), offline), 'Start path here')!.disabledReason).toBe('Needs the world database');
    expect(item(buildMenu(onSpawn(npc({ own: true })), offline), 'Change wander distance…')!.action).toBeDefined();
  });
});

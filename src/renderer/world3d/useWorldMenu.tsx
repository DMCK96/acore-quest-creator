import { useEffect, useRef, useState } from 'react';
import type { Api, GroupMove, QuestSpawnGroup, SpawnGroup } from '@shared/ipc';
import type { Placement, WorldLayer } from '@core/world/layer';
import { IDLE, type Movement } from '@core/world/movement';
import type { Role, RoleTarget } from '@core/modules/quest-roles';
import type { World3D } from './world3d';
import type { SpawnEdit, SpawnRef } from './edits';
import type { ProjectEntities } from '@core/entities/model';
import type { At, MenuAction, MenuGroup, MenuSpawn, MenuTarget, QuestMenuInfo } from './menu/model';
import { buildMenu, NEEDS_GROUND } from './menu/section';
import { subjectOf } from './menu/subject';
import { clipEntries, copySpawns, duplicateOffset, entriesOf, layoutAt, pasteable, type ClipEntry } from './clipboard';
import { placementAt } from './placing';
import { WorldContextMenu } from './WorldContextMenu';
import { WanderDialog } from './WanderDialog';
import { RespawnDialog } from './RespawnDialog';
import { GroupDialog } from './GroupDialog';
import { PlaceDialog, type Chosen } from './PlaceDialog';
import { useHistorySteps } from '../state/history-context';

export const NO_LONGER_HERE = 'That spawn is no longer here';
export const COPIED_COORDINATES = 'Copied .go xyz to the clipboard';

/** What the right-click menu needs of the view round it */
export interface WorldMenuDeps {
  world: React.RefObject<World3D | null>;
  api: Api | null;
  map: number;
  active: boolean;
  /** Sends an edit as the view sends any: the quest's own to the quest, the rest to the world layer, in order; whether it was kept */
  send(edit: SpawnEdit): Promise<boolean>;
  takeLayer(layer: WorldLayer): void;
  setNote(note: string | null): void;
  /** The server's floor nearest a height at a place, or null when it has none there */
  floorZ(x: number, y: number, nearZ: number): Promise<number | null>;
  placing: boolean;
  stopPlacing(): void;
  clearSelection(): void;
  /** Gives the keyboard back to the view */
  focusView(): void;
  /** The middle of the view in the window, where Ctrl+V pastes when the pointer has not been over it */
  viewCentre(): { x: number; y: number };
  /** Paths started in this view, which the database does not have */
  newPaths: Set<number>;
  /** Whether a path is one the database does not have (started here, or before a restart) */
  isNewPath(pathId: number): boolean;
  quest?: QuestMenuInfo;
  /** The quests of the open quest's chain, the open one among them */
  chainIds?: number[];
  onOwnEdit?(edit: SpawnEdit): boolean | void;
  /** Gives a spawn's NPC or object a part in the open quest, or takes it away; says why when it could not */
  onQuestRole?(role: Role, target: RoleTarget, on: boolean): string | null;
  onNewQuest?(giver: { entry: number; name: string }, after: boolean): void;
  onShowSpawns?(groups: QuestSpawnGroup[], scope: 'quest' | 'chain'): void;
  /** Makes a new project NPC or object with one spawn at `at`, as one step */
  onCreateEntity?(what: 'creature' | 'object', at: Placement): Promise<void>;
  /** Opens the editor on one of the project's NPCs or objects */
  onEditEntity?(kind: 'creature' | 'object', entry: number): void;
  /** Makes a project object lootable, or no longer */
  onSetLootable?(entry: number, on: boolean): Promise<void>;
  /** The project's NPCs, objects and items: whether a right-clicked spawn's NPC or object is the project's own */
  entities: ProjectEntities;
}

type Put = { kind: 'creature' | 'object'; entry: number; own: boolean; at: Placement; respawnSecs?: number; wander?: number };

const refOf = (s: { kind: 'creature' | 'object'; guid: number; entry: number; own: boolean }): SpawnRef => ({ kind: s.kind, guid: s.guid, entry: s.entry, own: s.own });
const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;
/** A spawn's kind as spawn groups name it */
const poolKind = (kind: 'creature' | 'object'): 'npc' | 'object' => (kind === 'object' ? 'object' : 'npc');

/** Spawns whose respawn time the dialog changes: what each is, its name, and its time when known */
type RespawnTarget = { ref: SpawnRef; name: string; respawnSecs: number | null };
const respawnTargetOf = (s: MenuSpawn): RespawnTarget => ({ ref: refOf(s), name: s.name, respawnSecs: s.respawnSecs });

/** A spawn group open in the dialog: the members by name, and the other groups on its map */
type GroupEdit = { group: SpawnGroup; names: Map<string, string>; groupsOnMap: { id: number; name: string }[]; events: { id: number; name: string }[]; nested: boolean };

/**
 * The 3D view's right-click menu: what it offers for a right-clicked target, and what each item does.
 * Placing, pasting and removing are recorded as one undo step each; movement goes through the view's
 * edits like a move does. Ctrl+C, Ctrl+V and Ctrl+D copy, paste and duplicate.
 */
export function useWorldMenu(deps: WorldMenuDeps): {
  open(target: MenuTarget, client: { x: number; y: number }): void;
  shortcut(code: 'KeyC' | 'KeyV' | 'KeyD'): boolean;
  onDrawing(drawing: { guid: number; points: number } | null): void;
  /** Opens the spawn group dialog on a group */
  editGroup(id: number): void;
  elements: React.JSX.Element;
} {
  const d = useRef(deps);
  d.current = deps;
  // Each action is one step of the project's history, however many changes it makes
  const { runStep } = useHistorySteps();
  const step = useRef(runStep);
  step.current = runStep;
  const [menu, setMenu] = useState<{ groups: MenuGroup[]; at: { x: number; y: number } } | null>(null);
  const [place, setPlace] = useState<{ what: 'creature' | 'object'; at: At } | null>(null);
  const [wander, setWander] = useState<{ spawn: MenuSpawn } | null>(null);
  const [respawn, setRespawn] = useState<{ targets: RespawnTarget[] } | null>(null);
  const [groupEdit, setGroupEdit] = useState<GroupEdit | null>(null);
  const [drawing, setDrawing] = useState<{ guid: number; points: number } | null>(null);
  const drawingRef = useRef(drawing);
  drawingRef.current = drawing;
  const [marked, setMarked] = useState(false);

  // A menu belongs to the world it was opened on
  useEffect(() => setMenu(null), [deps.map, deps.active]);
  // A path being drawn, and quest marks, belong to their world: a new map's world starts without them
  useEffect(() => {
    setDrawing(null);
    drawingRef.current = null;
    setMarked(false);
  }, [deps.map]);
  // Marks belong to the quest they were shown for
  const questId = deps.quest?.id ?? null;
  useEffect(() => {
    d.current.world.current?.setMarked(null);
    setMarked(false);
  }, [questId]);

  const open = (target: MenuTarget, client: { x: number; y: number }): void => {
    const { api, map, placing, quest, onNewQuest } = d.current;
    const entries = clipEntries();
    const groups = buildMenu(subjectOf(target, d.current.entities), {
      map,
      connected: api !== null,
      clipboard: { count: entries.length, blocked: null },
      placing,
      drawing,
      quest: quest ?? null,
      project: onNewQuest !== undefined,
      marked,
    });
    if (groups.length > 0) setMenu({ groups, at: client });
  };

  const floored = async (at: Placement): Promise<Placement> => ({ ...at, z: (await d.current.floorZ(at.x, at.y, at.z)) ?? at.z });
  const facingCamera = (at: At, kind: 'creature' | 'object'): Placement => placementAt(at, d.current.world.current?.camera().position ?? at, kind);

  /** Puts one spawn down: a quest's own goes to the quest, the rest to the world layer. The edit that did it, or null */
  const putOne = async (put: Put): Promise<SpawnEdit | null> => {
    const { api, map, onOwnEdit, setNote, takeLayer } = d.current;
    if (!api) return null;
    if (put.own) {
      if (!onOwnEdit) return null;
      const ids = await api.allocateIds(put.kind === 'creature' ? 'creatureSpawn' : 'gameobjectSpawn', 1);
      if (!ids.ok || ids.value.length === 0) {
        setNote(ids.ok ? 'No free spawn ID could be found.' : ids.error.message);
        return null;
      }
      const edit: SpawnEdit = { kind: 'presence', spawn: { kind: put.kind, guid: ids.value[0]!, entry: put.entry, own: true }, present: true, at: put.at, map };
      return onOwnEdit(edit) === false ? null : edit;
    }
    const result = await api.worldAddSpawn(put.kind === 'object' ? 'gameobject' : 'creature', put.entry, map, put.at);
    if (!result.ok) {
      setNote(result.error.message);
      return null;
    }
    takeLayer(result.value.layer);
    return { kind: 'presence', spawn: { kind: put.kind, guid: result.value.guid, entry: put.entry, own: false }, present: true, at: put.at, map };
  };

  /** Puts spawns down one after another, selects them, and makes them one undo step; how many went down */
  const putAll = async (puts: Put[], label?: string): Promise<number> => {
    const done: SpawnEdit[] = [];
    await step.current(async () => {
      for (const put of puts) {
        const edit = await putOne(put);
        if (!edit) continue;
        done.push(edit);
        if (put.respawnSecs !== undefined && put.respawnSecs !== 300) await d.current.send({ kind: 'respawn', spawn: edit.spawn, secs: put.respawnSecs });
        if (put.kind === 'creature' && put.wander !== undefined && put.wander > 0) await d.current.send({ kind: 'movement', spawn: edit.spawn, to: { type: 'wander', wander: put.wander, pathId: null } });
      }
    }, label);
    const world = d.current.world.current;
    if (done.length > 0 && world) {
      world.selectSpawns(done.map((e) => ({ kind: e.spawn.kind, guid: e.spawn.guid })));
    }
    return done.length;
  };

  const paste = async (entries: readonly ClipEntry[], at: At, verb = 'Paste'): Promise<void> => {
    const { map } = d.current;
    const ok = pasteable(entries);
    if (ok.entries.length === 0) return;
    const laid = await Promise.all(layoutAt(ok.entries, at, map).map(async (l) => ({ kind: l.entry.kind, entry: l.entry.entry, own: l.entry.own, at: await floored(l.at), respawnSecs: l.entry.respawnSecs, wander: l.entry.wander })));
    await putAll(laid, laid.length === 1 ? `${verb} a spawn` : `${verb} ${laid.length} spawns`);
  };

  const copy = (): void => {
    const spawns = d.current.world.current?.selectedSpawns() ?? [];
    if (spawns.length === 0) return;
    copySpawns(spawns);
    d.current.setNote(`Copied ${plural(spawns.length, 'spawn')}`);
  };

  const duplicate = async (): Promise<void> => {
    const world = d.current.world.current;
    const spawns = world?.selectedSpawns() ?? [];
    if (!world || spawns.length === 0) return;
    const mean = (pick: (p: Placement) => number): number => spawns.reduce((sum, s) => sum + pick(s.placement), 0) / spawns.length;
    const off = duplicateOffset(world.camera().direction);
    await paste(entriesOf(spawns), { x: mean((p) => p.x) + off.x, y: mean((p) => p.y) + off.y, z: mean((p) => p.z) }, 'Duplicate');
  };

  /** Whether a spawn is still there to act on; says so when it is not */
  const still = (spawn: MenuSpawn): boolean => {
    if (d.current.world.current?.hasSpawn(spawn.kind, spawn.guid)) return true;
    d.current.setNote(NO_LONGER_HERE);
    return false;
  };

  /** Sends edits the menu made, one after another, as one step */
  const commit = async (edits: SpawnEdit[], label?: string): Promise<void> => {
    await step.current(async () => {
      for (const edit of edits) await d.current.send(edit);
    }, label);
  };

  /** The other spawn groups on the map being viewed, by name; none when they cannot be had */
  const groupsHere = async (except: number): Promise<{ id: number; name: string }[]> => {
    const found = await d.current.api?.worldGroupsOnMap(d.current.map);
    return found?.ok ? found.value.filter((g) => g.id !== except).map((g) => ({ id: g.id, name: g.name })) : [];
  };

  /** The game events a group can follow, and whether the group is a member of another on the map */
  const eventChoices = async (id: number): Promise<{ events: { id: number; name: string }[]; nested: boolean }> => {
    const { api, map } = d.current;
    const [events, onMap] = await Promise.all([api?.gameEvents(), api?.worldGroupsOnMap(map)]);
    return {
      events: events?.ok ? events.value : [],
      nested: onMap?.ok ? onMap.value.some((g) => g.groups.includes(id)) : false,
    };
  };

  /** Opens the dialog on a spawn group, its members named as the view describes them */
  const openGroup = async (id: number): Promise<void> => {
    const { api, setNote } = d.current;
    if (!api) return;
    const [found, view] = await Promise.all([api.worldGroup(id), api.worldGroupView(id)]);
    if (!found.ok || !found.value) {
      setNote(found.ok ? 'That spawn group is no longer there.' : found.error.message);
      return;
    }
    const names = new Map(view.ok && view.value ? view.value.members.map((m) => [m.key, m.name] as const) : []);
    setGroupEdit({ group: found.value, names, groupsOnMap: await groupsHere(id), ...(await eventChoices(id)) });
  };

  /** Saves a group as one step; a refusal says why, keeps the dialog open and leaves no change */
  const saveGroup = async (group: SpawnGroup, moves: GroupMove[]): Promise<void> => {
    const { api, setNote } = d.current;
    if (!api) return;
    let saved = false;
    await step.current(async () => {
      const result = await api.worldSetGroup(group, moves);
      if (!result.ok) {
        setNote(result.error.message);
        return;
      }
      saved = true;
      d.current.takeLayer(result.value);
    }, `Saved spawn group ${group.name || group.id}`);
    if (saved) {
      setGroupEdit(null);
      d.current.focusView();
    }
  };

  /** The respawn dialog for a group's own spawns: a project spawn's time is the project's */
  const respawnGroup = (group: SpawnGroup, names: ReadonlyMap<string, string>): void => {
    const { entities } = d.current;
    const targets = group.members.flatMap((m): RespawnTarget[] => {
      if (m.type !== 'spawn') return [];
      const kind = m.kind === 'object' ? 'object' : 'creature';
      const stored = (kind === 'object' ? entities.objects : entities.npcs).flatMap((e) => e.spawns).find((s) => s.guid === m.guid);
      return [{ ref: { kind, guid: m.guid, entry: m.entry, own: stored !== undefined }, name: names.get(`${m.kind}:${m.guid}`) ?? `Spawn ${m.guid}`, respawnSecs: stored?.respawnSecs ?? null }];
    });
    if (targets.length === 0) {
      d.current.setNote('This group has no spawns of its own.');
      return;
    }
    setRespawn({ targets });
  };

  const run = async (action: MenuAction): Promise<void> => {
    const { world: worldRef, api, setNote } = d.current;
    const world = worldRef.current;
    if (!world) return;
    switch (action.kind) {
      case 'stopPlacing':
        d.current.stopPlacing();
        return;
      case 'finishPath':
        world.finishPath();
        return;
      case 'undoPoint':
        world.undoPoint();
        return;
      case 'cancelPath':
        world.cancelPath();
        return;
      case 'placeHere':
        setPlace({ what: action.what, at: action.at });
        return;
      case 'newEntity':
        await d.current.onCreateEntity?.(action.what, await floored(facingCamera(action.at, action.what)));
        return;
      case 'editEntity':
        d.current.onEditEntity?.(action.spawn.kind, action.spawn.entry);
        return;
      case 'setLootable':
        await d.current.onSetLootable?.(action.spawn.entry, action.on);
        return;
      case 'copy':
        copy();
        return;
      case 'paste':
        await paste(clipEntries(), action.at);
        return;
      case 'duplicate':
        await duplicate();
        return;
      case 'remove': {
        const { spawn } = action;
        if (!still(spawn)) return;
        const gone: SpawnEdit = { kind: 'presence', spawn: refOf(spawn), present: false, at: spawn.placement, map: spawn.map };
        await step.current(async () => {
          const kept = await d.current.send(gone);
          // A removed spawn is no member of any group: taken out of its group in the same step
          if (!kept || spawn.group === null || spawn.group === undefined || !api) return;
          const dropped = await api.worldDropMember(poolKind(spawn.kind), spawn.guid);
          if (dropped.ok) d.current.takeLayer(dropped.value);
          else setNote(dropped.error.message);
        });
        d.current.clearSelection();
        return;
      }
      case 'copyCoordinates': {
        const { x, y, z } = action.at;
        try {
          await navigator.clipboard.writeText(`.go xyz ${x.toFixed(2)} ${y.toFixed(2)} ${z.toFixed(2)} ${d.current.map}`);
          setNote(COPIED_COORDINATES);
        } catch (error) {
          setNote(`Could not copy to the clipboard: ${error instanceof Error ? error.message : String(error)}`);
        }
        return;
      }
      case 'startPath': {
        const { spawn } = action;
        if (!api || !still(spawn)) return;
        const id = spawn.own ? await api.patrolPathId(spawn.guid) : await api.worldNewPathId(spawn.guid);
        if (!id.ok) {
          setNote(id.error.message);
          return;
        }
        if (!spawn.own) d.current.newPaths.add(id.value);
        world.startPath(spawn.guid, id.value, action.at);
        return;
      }
      case 'wander':
        if (!still(action.spawn)) return;
        setWander({ spawn: action.spawn });
        return;
      case 'respawn':
        if (!action.spawns.every(still)) return;
        setRespawn({ targets: action.spawns.map(respawnTargetOf) });
        return;
      case 'groupSpawns': {
        if (!api) return;
        const id = await api.worldNewGroupId();
        if (!id.ok) {
          setNote(id.error.message);
          return;
        }
        const { spawns } = action;
        const group: SpawnGroup = {
          id: id.value,
          name: '',
          map: d.current.map,
          maxActive: 1,
          members: spawns.map((s) => ({ type: 'spawn', kind: poolKind(s.kind), guid: s.guid, entry: s.entry, chance: 0 })),
          event: null,
          origin: { kind: 'new' },
        };
        const names = new Map(spawns.map((s) => [`${poolKind(s.kind)}:${s.guid}`, s.name]));
        setGroupEdit({ group, names, groupsOnMap: await groupsHere(id.value), ...(await eventChoices(id.value)) });
        return;
      }
      case 'editGroup':
        await openGroup(action.id);
        return;
      case 'showGroup': {
        if (!api) return;
        const found = await api.worldGroup(action.id);
        if (!found.ok) {
          setNote(found.error.message);
          return;
        }
        const first = found.value?.members.find((m) => m.type === 'spawn');
        if (!first || first.type !== 'spawn') {
          setNote('This group has no spawns of its own to show.');
          return;
        }
        world.selectSpawns([{ kind: first.kind === 'object' ? 'object' : 'creature', guid: first.guid }]);
        return;
      }
      case 'leaveGroup': {
        const { spawn } = action;
        if (!api || spawn.group === null || spawn.group === undefined) return;
        const found = await api.worldGroup(spawn.group);
        if (!found.ok || !found.value) {
          setNote(found.ok ? 'That spawn group is no longer there.' : found.error.message);
          return;
        }
        const group = found.value;
        const kind = poolKind(spawn.kind);
        const members = group.members.filter((m) => !(m.type === 'spawn' && m.kind === kind && m.guid === spawn.guid));
        await step.current(async () => {
          // A group left with no members is deleted; otherwise no more of it can be up than it has members
          const result =
            members.length === 0
              ? await api.worldDeleteGroup(group.id)
              : await api.worldSetGroup({ ...group, members, maxActive: Math.max(1, Math.min(group.maxActive, members.length)) }, []);
          if (result.ok) d.current.takeLayer(result.value);
          else setNote(result.error.message);
        }, `Took ${spawn.name} out of spawn group ${group.name || group.id}`);
        return;
      }
      case 'removePath': {
        const { spawn } = action;
        if (!still(spawn)) return;
        const ref = refOf(spawn);
        const after: SpawnEdit[] = [{ kind: 'movement', spawn: ref, to: IDLE }];
        // A path made in this view is taken back with it; a database path is left for whoever else walks it
        if (!spawn.own && d.current.isNewPath(spawn.pathId)) after.push({ kind: 'route', spawn: ref, pathId: spawn.pathId, points: [] });
        await commit(after, `Removed the path of ${spawn.name}`);
        return;
      }
      case 'toggleRole': {
        const target: RoleTarget = { kind: action.spawn.kind === 'object' ? 'gameobject' : 'creature', id: action.spawn.entry };
        let why: string | null = null;
        await step.current(async () => {
          why = d.current.onQuestRole?.(action.role, target, action.on) ?? null;
        });
        if (why) setNote(why);
        return;
      }
      case 'newQuest':
        d.current.onNewQuest?.({ entry: action.spawn.entry, name: action.spawn.name }, action.after);
        return;
      case 'showSpawns': {
        const { quest, chainIds, map } = d.current;
        if (!api || !quest) return;
        const ids = action.scope === 'quest' ? [quest.id] : (chainIds ?? [quest.id]);
        const result = await api.questSpawnList(ids);
        if (!result.ok) {
          setNote(result.error.message);
          return;
        }
        const here = result.value.flatMap((g) => g.spawns).filter((s) => s.map === map);
        world.setMarked(here.map((s) => ({ kind: s.kind === 'gameobject' ? 'object' : 'creature', guid: s.guid })));
        setMarked(true);
        d.current.onShowSpawns?.(result.value, action.scope);
        return;
      }
      case 'hideSpawns':
        world.setMarked(null);
        setMarked(false);
        return;
    }
  };

  const pick = (action: MenuAction): void => {
    setMenu(null);
    d.current.focusView();
    run(action).catch((error: unknown) => d.current.setNote(error instanceof Error ? error.message : String(error)));
  };

  const shortcut = (code: 'KeyC' | 'KeyV' | 'KeyD'): boolean => {
    const world = d.current.world.current;
    if (!world) return false;
    // A paste or a duplicate while a path is drawn would land among the path's undo steps
    if (drawingRef.current && code !== 'KeyC') return true;
    if (code === 'KeyC') copy();
    else if (code === 'KeyD') void duplicate();
    else {
      const ground = world.groundAt(world.lastPointer() ?? d.current.viewCentre());
      if (!ground) d.current.setNote(NEEDS_GROUND);
      else void paste(clipEntries(), ground);
    }
    return true;
  };

  const placeOnce = async (chosen: Chosen, at: At): Promise<void> => {
    await putAll([{ kind: chosen.kind, entry: chosen.entry, own: false, at: await floored(facingCamera(at, chosen.kind)) }]);
  };

  const moving = (yards: number): Movement => ({ type: yards > 0 ? 'wander' : 'idle', wander: yards, pathId: null });

  const elements = (
    <>
      {menu && (
        <WorldContextMenu
          groups={menu.groups}
          at={menu.at}
          onPick={pick}
          onClose={() => {
            setMenu(null);
            d.current.focusView();
          }}
        />
      )}
      {place && (
        <PlaceDialog
          kind={place.what}
          once
          onPick={(chosen) => {
            const at = place.at;
            setPlace(null);
            d.current.focusView();
            void placeOnce(chosen, at);
          }}
          onClose={() => setPlace(null)}
        />
      )}
      {wander && (
        <WanderDialog
          name={wander.spawn.name}
          initial={wander.spawn.wander}
          onPreview={(yards) => d.current.world.current?.setPendingMovement(wander.spawn.guid, moving(yards))}
          onApply={(yards) => {
            const { spawn } = wander;
            setWander(null);
            d.current.focusView();
            const ref = refOf(spawn);
            void commit([{ kind: 'movement', spawn: ref, to: moving(yards) }]);
          }}
          onClose={() => {
            d.current.world.current?.setPendingMovement(wander.spawn.guid, null);
            setWander(null);
            d.current.focusView();
          }}
        />
      )}
      {groupEdit && (
        <GroupDialog
          // Another group in the dialog starts it afresh
          key={groupEdit.group.id}
          group={groupEdit.group}
          names={groupEdit.names}
          groupsOnMap={groupEdit.groupsOnMap}
          events={groupEdit.events}
          nested={groupEdit.nested}
          check={async (group, moves) => {
            const result = await d.current.api?.worldCheckGroup(group, moves);
            return !result ? { reasons: ['Needs the world database'], notes: [] } : result.ok ? result.value : { reasons: [result.error.message], notes: [] };
          }}
          onSave={(group, moves) => {
            saveGroup(group, moves).catch((error: unknown) => d.current.setNote(error instanceof Error ? error.message : String(error)));
          }}
          onRespawnAll={() => respawnGroup(groupEdit.group, groupEdit.names)}
          onClose={() => {
            setGroupEdit(null);
            d.current.focusView();
          }}
        />
      )}
      {respawn && (
        <RespawnDialog
          names={respawn.targets.map((t) => t.name)}
          // Spawns with different (or unknown) times start blank
          initial={respawn.targets.every((t) => t.respawnSecs === respawn.targets[0]!.respawnSecs) ? respawn.targets[0]!.respawnSecs : null}
          onApply={(secs) => {
            const { targets } = respawn;
            setRespawn(null);
            d.current.focusView();
            const label = targets.length === 1 ? `Respawn time of ${targets[0]!.name}` : `Respawn time of ${targets.length} spawns`;
            void commit(targets.map((t) => ({ kind: 'respawn', spawn: t.ref, secs })), label);
          }}
          onClose={() => {
            setRespawn(null);
            d.current.focusView();
          }}
        />
      )}
    </>
  );

  const editGroup = (id: number): void => {
    openGroup(id).catch((error: unknown) => d.current.setNote(error instanceof Error ? error.message : String(error)));
  };

  return { open, shortcut, onDrawing: setDrawing, editGroup, elements };
}

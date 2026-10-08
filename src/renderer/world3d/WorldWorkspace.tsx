import { popPlace, pushPlace, type CameraPlace } from './camera-history';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CanvasNode, GroupView, OpenResult, QuestSpawnGroup } from '@shared/ipc';
import type { FieldValue } from '@core/registry/types';
import { EMPTY_ENTITIES, newSpawn, type CustomObject, type ProjectEntities } from '@core/entities/model';
import type { Placement } from '@core/world/layer';
import { EntityEditorHost, type EditorState } from '../entities/EntityEditorHost';
import { useHistorySteps } from '../state/history-context';
import { useProjectEntities } from '../state/project-entities';
import { ownViewSpawns } from '@core/entities/view-spawns';
import { hasRole, toggleRole } from '@core/modules/quest-roles';
import { useApi, useNameBook } from '../state/names';
import { giverName } from '@core/modules/summaries';
import { ownEdit } from './own-edit';
import { newSpawnGuid } from './spawn-guid';
import { chainOf, questMenuInfo } from './quest-context';
import { OBJECTIVES_FULL } from './menu/section';
import { groupWorldMaps, isTerrainMap, worldMapById } from '@core/map/world-maps';
import { frameOfView, hostMapIdOf, normaliseView, type TransportView } from '@core/map/transport-view';
import { docksOn } from '@core/map/transport-docks';
import { toLocal, toWorld, type Frame } from '@core/map/transport-frame';
import { TransportBar } from './TransportBar';
import { useClientMaps } from './useClientMaps';
import type { TeleportSpot } from '@core/map/teleports';
import { World3DView, type FocusTarget } from './World3DView';
import type { PickedSpawn } from './scene/spawn/SpawnManager';
import { FindDialog, type FindPreset, type FoundSpawn } from './FindDialog';
import { TeleportDialog } from './TeleportDialog';
import { QuestOrb } from '../components/QuestOrb';
import { questPlace } from './quest-place';
import { PlaceInWorldProvider, ShowInWorldProvider, useAsideForWorld, type ShowTarget, type WorldRequest } from './ShowInWorldContext';
import { questLabel } from '@core/links/drag-link';
import { useFocusFollow } from './useFocusFollow';
import type { FocusPart, FocusSlice } from '../state/app/focus';
import { NEEDS_DATABASE } from './menu/section';
import { readLastPlace, readSavedPlace, writeLastPlace } from './last-place';
import { markWelcomeSeen, welcomeSeen } from './welcome-seen';
import { Welcome } from './Welcome';
import { useQuestMarkers } from './useQuestMarkers';
import type { MarkerFocus } from './useMarkerView';
import './world3d.css';

export interface WorldWorkspaceProps {
  /** Whether a game client folder is set: the world is drawn from it */
  hasClient: boolean;
  /** The open project's key (see `projectKey`), for its first-time welcome */
  projectKey: string;
  projectName: string;
  onOpenSettings(): void;
  onShowQuests(): void;
  onStartQuest(): void;
  /** The open quest and the canvas it is on: its own spawns are drawn and edited here, and the menu offers it */
  quest?: { open: OpenResult; nodes: CanvasNode[] };
  /** Changes one of the open quest's fields */
  onQuestField?(fieldId: string, value: FieldValue): void;
  /** Starts a new quest given and taken back by an NPC, after `previous` in its chain when that is set */
  onNewQuest?(giver: { entry: number; name: string }, previous: number | null): void;
  /** Opens a quest the database has in the quest editor */
  onOpenQuest?(id: number): void;
  /** A place to take the camera to (Show on the undo note); each request is its own, even to the same place */
  goTo?: { map: number; x: number; y: number; z: number; nonce: number };
  /**
   * The quest (or one of its NPCs or objects) every view is on: the camera goes to each new one, unless
   * it was moved after the focus was set (see `useFocusFollow`)
   */
  focus?: FocusSlice['focus'];
  /** Told when an NPC or object selected here plays a part in the open quest: it becomes the focus */
  onFocusPart?(questId: number, part: FocusPart): void;
  /** Now, on the clock `focus.at` is read against (the store's `moment`) */
  now?: () => number;
  /** An editor's Place in world, Draw patrol, or a spawn's or quest position's Show in World; each request is its own */
  request?: WorldRequest & { nonce: number };
  /** Told when what an editor asked is done (placing stopped, the patrol drawn), so the editor comes back */
  onRequestEnd?(): void;
}

const NO_FOCUS: FocusSlice['focus'] = { questId: null, part: null, nonce: 0, at: 0 };
const ROLES = ['giver', 'ender', 'objective'] as const;

const ROLE_LABELS: Record<QuestSpawnGroup['spawns'][number]['role'], string> = { giver: 'givers', ender: 'enders', objective: 'objectives', own: 'own' };

/** A quest's spawns as the Find dialog lists them: by quest, then by role */
function presetOf(groups: QuestSpawnGroup[], scope: 'quest' | 'chain'): FindPreset {
  const title = scope === 'chain' ? 'Spawns of the chain' : `Spawns of ${groups[0]?.title ?? 'the quest'}`;
  return {
    title,
    cut: groups.reduce((sum, g) => sum + (g.cut ?? 0), 0),
    groups: groups.flatMap((g) =>
      (['giver', 'ender', 'objective', 'own'] as const).flatMap((role) => {
        const spawns = g.spawns
          .filter((s) => s.role === role)
          .map((s): FoundSpawn => ({ kind: s.kind === 'gameobject' ? 'object' : 'creature', guid: s.guid, entry: s.entry, name: s.name, map: s.map, x: s.x, y: s.y, z: s.z, event: s.event ?? null, note: null }));
        return spawns.length > 0 ? [{ label: `${g.title}: ${ROLE_LABELS[role]}`, spawns }] : [];
      }),
    ),
  };
}

type Point = { x: number; y: number; z: number };

/** One spawn of the project's own NPC or object, as Find lists it; null when the project has no such spawn */
function ownSpawnOf(store: ProjectEntities, kind: 'creature' | 'object', entry: number, guid: number, name: string): FoundSpawn | null {
  const spawn = (kind === 'object' ? store.objects : store.npcs).find((e) => e.entry === entry)?.spawns.find((s) => s.guid === guid);
  return spawn ? { kind, guid, entry, name, map: spawn.map, x: spawn.x, y: spawn.y, z: spawn.z, event: null, note: null } : null;
}

/** How long the welcome takes to fade from the world once something is chosen (matches Welcome.css) */
const WELCOME_FADE_MS = 500;

/**
 * The world, as the app's main workspace: the 3D view of a continent with a place card (where the
 * camera is, Teleport, Find and typed coordinates). It opens where it was left. Without a game client
 * it says what is needed instead. The first time a project is shown here, a welcome over the orb offers
 * a place to start.
 */
export function WorldWorkspace({
  hasClient, projectKey, projectName, onOpenSettings, onShowQuests, onStartQuest, quest, onQuestField, onNewQuest, onOpenQuest, goTo: goToRequest,
  focus: shared = NO_FOCUS, onFocusPart, now = Date.now, request, onRequestEnd,
}: WorldWorkspaceProps): React.JSX.Element {
  // The open quest's values as last changed here, so edits made one after another build on each other
  const values = useRef(quest?.open.aggregate.values);
  values.current = quest?.open.aggregate.values;
  const change = (fieldId: string, value: FieldValue): void => {
    if (values.current) values.current = { ...values.current, [fieldId]: value };
    onQuestField?.(fieldId, value);
  };
  const project = useProjectEntities();
  const store = project?.entities ?? EMPTY_ENTITIES;
  const info = useMemo(() => (quest ? questMenuInfo(quest.open, quest.nodes) : undefined), [quest]);
  const chainIds = useMemo(() => (quest ? chainOf(quest.nodes, quest.open.questId) : undefined), [quest]);
  // The project's NPCs and objects; edits to their spawns go to the whole store
  const storeRef = useRef(store);
  storeRef.current = store;
  // Every project spawn is drawn and edited here, whether or not a quest is open
  const own = useMemo(() => ownViewSpawns(store), [store]);
  const { runStep } = useHistorySteps();
  const api = useApi();
  const { maps, ready: mapsReady } = useClientMaps(api, hasClient);
  const names = useNameBook();
  const namesRef = useRef(names);
  namesRef.current = names;
  // The NPC or object editor, opened from the right-click menu
  const [editor, setEditor] = useState<EditorState | null>(null);
  // The editor steps aside while the author places or draws in the world from it
  const [editorAside, editorPlace, editorShow] = useAsideForWorld();
  const [note, setNote] = useState<string | null>(null);

  /** New NPC here… / New object here…: one project NPC or object with a spawn where it was asked for, as one step */
  const createEntity = async (what: 'creature' | 'object', at: Placement): Promise<void> => {
    if (!project || !api) return;
    let made: { kind: 'npc' | 'object'; entry: number } | null = null;
    await runStep(async () => {
      const guid = await newSpawnGuid(api, what);
      if ('error' in guid) {
        setNote(guid.error);
        return;
      }
      const spawn = { ...newSpawn(guid.guid), map: mapRef.current, x: at.x, y: at.y, z: at.z, o: at.orientation, rotation: what === 'object' ? at.rotation : null };
      const kind = what === 'creature' ? 'npc' : 'object';
      const result = await project.create(kind, { spawns: [spawn] });
      if ('error' in result) setNote(result.error);
      else made = { kind, entry: result.entry };
    }, what === 'creature' ? 'New NPC' : 'New object');
    const opened = made as { kind: 'npc' | 'object'; entry: number } | null;
    if (opened) setEditor({ kind: opened.kind, entry: opened.entry, isNew: true, tab: 'basics' });
  };

  /** Edit NPC… / Edit object…: an existing one is brought into the project first, then its editor opens */
  const editEntity = async (what: 'creature' | 'object' | 'item', entry: number): Promise<void> => {
    if (!project) return;
    const kind = what === 'creature' ? 'npc' : what;
    const error = await project.ensure({ kind, entry });
    if (error) setNote(error);
    else setEditor({ kind, entry, isNew: false });
  };

  /**
   * Make lootable… / Stop being lootable on an object, asking first when it would stop doing something
   * else. A database object the project does not hold yet is read first (to ask and to see its type is
   * not locked), then brought in and changed in one step.
   */
  const setLootable = async (entry: number, on: boolean): Promise<void> => {
    if (!project) return;
    let object = storeRef.current.objects.find((o) => o.entry === entry);
    let adopting: CustomObject | null = null;
    if (!object) {
      if (!api) return;
      const read = await api.readExistingEntity('object', entry);
      if (!read.ok) {
        setNote(read.error.message);
        return;
      }
      adopting = read.value as CustomObject;
      object = adopting;
    }
    const name = object.name.trim() || 'this object';
    if (object.origin.kind === 'existing' && object.origin.locked.includes('type')) {
      setNote(`${name}'s type cannot be changed: it is one this editor does not change.`);
      return;
    }
    if (on && object.pages.length > 0 && !window.confirm(`Make ${name} lootable? Its pages are not shown once it can be looted.`)) return;
    if (on && object.pages.length === 0 && object.onlyDuringQuest !== null && object.type === 'goober'
      && !window.confirm(`Make ${name} lootable? Its quest-only use stops; only its loot can be quest-only.`)) return;
    const type = on ? 'chest' as const : 'goober' as const;
    let changed = false;
    await runStep(async () => {
      if (adopting) {
        const error = await project.ensure({ kind: 'object', entry });
        if (error) {
          setNote(error);
          return;
        }
      }
      // Brought in just now: the store this view holds has not caught up yet, so the object read is added to it
      const base = storeRef.current;
      const objects = base.objects.some((o) => o.entry === entry) || !adopting ? base.objects : [...base.objects, adopting];
      const next = { ...base, objects: objects.map((o) => (o.entry === entry ? { ...o, type } : o)) };
      storeRef.current = next;
      project.setEntities(next);
      changed = true;
    }, on ? `Made ${name} lootable` : `Stopped ${name} being lootable`);
    if (on && changed) setEditor({ kind: 'object', entry, isNew: false, tab: 'contents' });
  };
  // The spawns of the open quest or its chain, listed after the menu showed them
  const [preset, setPreset] = useState<FindPreset | null>(null);
  const [first] = useState(readLastPlace);
  const [mapId, setMapId] = useState(first.map);
  const [at, setAt] = useState<Point>({ x: first.x, y: first.y, z: first.z });
  const mapRef = useRef(mapId);
  mapRef.current = mapId;
  // On a transport's map: the route and stop its vessel is shown at, as last chosen (made valid for the map below)
  const [chosenView, setChosenView] = useState<Partial<TransportView> | undefined>(first.transport);
  const shownMap = worldMapById(mapId);
  const transportMap = shownMap?.kind === 'transport' ? shownMap : null;
  const transportView = transportMap ? normaliseView(transportMap, chosenView, isTerrainMap) : null;
  // The vessels that stop on the terrain shown, but for the transport map the view itself shows
  const hostMapId = transportMap && transportView ? hostMapIdOf(transportMap, transportView) : mapId;
  const docks = useMemo(() => docksOn(maps, hostMapId, transportMap?.id), [maps, hostMapId, transportMap?.id]);
  const viewRef = useRef(transportView);
  viewRef.current = transportView;
  /** Remembers where the camera is on the map shown, with the transport's route and stop there */
  const remember = (point: Point): void => writeLastPlace({ map: mapRef.current, ...point, ...(viewRef.current && { transport: viewRef.current }) });
  /** The vessel a transport map's passengers are shown on: at the stop shown on the open map, else at its dock, where opening it starts */
  const vesselFrame = (map: number): Frame | null => {
    const transportOf = worldMapById(map);
    if (transportOf?.kind !== 'transport') return null;
    return frameOfView(transportOf, map === mapRef.current && viewRef.current ? viewRef.current : normaliseView(transportOf, undefined, isTerrainMap));
  };
  /** Where a spawn's stored place is in the World: a passenger's vessel-local place, carried by its vessel */
  const inWorld = (map: number, stored: Point): Point => {
    const frame = vesselFrame(map);
    if (!frame) return stored;
    const { x, y, z } = toWorld(frame, stored);
    return { x, y, z };
  };
  /** A place in the World as a spawn on `map` stores it, to measure from it to spawns */
  const asStored = (map: number, point: Point): Point => {
    const frame = vesselFrame(map);
    if (!frame) return point;
    const { x, y, z } = toLocal(frame, point);
    return { x, y, z };
  };
  // The coordinates being typed; they only move the camera on Go.
  const [typed, setTyped] = useState({ x: String(first.x), y: String(first.y), z: String(first.z) });
  const [area, setArea] = useState<string | null>(null);
  const [coordinates, setCoordinates] = useState(false);
  const [teleporting, setTeleporting] = useState(false);
  const [finding, setFinding] = useState(false);
  // The spawn the view is to bring into view (each pick is its own, even of the same spawn)
  const [focus, setFocus] = useState<FocusTarget | undefined>();
  // Projects whose welcome was closed here; read with what storage says, so a project greeted elsewhere is not greeted again
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const welcoming = hasClient && !closed.has(projectKey) && !welcomeSeen(projectKey);
  // The welcome fading out over the world after a choice (the choice itself happens at once)
  const [fading, setFading] = useState(false);
  useEffect(() => {
    if (!fading) return;
    const timer = setTimeout(() => setFading(false), WELCOME_FADE_MS);
    return () => clearTimeout(timer);
  }, [fading]);
  /** Closes the welcome for this project for good, then does what was chosen */
  const leaveWelcome = (then?: () => void): void => {
    markWelcomeSeen(projectKey);
    setClosed((keys) => new Set(keys).add(projectKey));
    setFading(true);
    then?.();
  };

  /** Moves the camera to a point, on the map given (this one by default), and remembers it */
  const goTo = (point: Point, map = mapRef.current): void => {
    if (map !== mapRef.current) {
      setMapId(map);
      // Another map starts at its own route's first stop
      setChosenView(undefined);
      viewRef.current = null;
    }
    mapRef.current = map;
    setAt(point);
    placeRef.current = point;
    setTyped({ x: String(point.x), y: String(point.y), z: String(point.z) });
    remember(point);
  };
  /**
   * Another route or stop of the transport shown: the camera goes to the vessel there. Not a jump Back
   * returns from: the place left may be on another continent's terrain than the one the vessel is now on
   */
  const chooseView = (view: TransportView): void => {
    if (!transportMap) return;
    setChosenView(view);
    viewRef.current = view;
    lastCameraMove.current = nowRef.current();
    const { x, y, z } = frameOfView(transportMap, view);
    goTo({ x, y, z });
  };
  // Where the camera has been before each jump, for Back
  const [back, setBack] = useState<CameraPlace[]>([]);
  const placeRef = useRef<Point>({ x: first.x, y: first.y, z: first.z });
  const areaRef = useRef(area);
  areaRef.current = area;
  // When the camera last moved (the author flying or dragging it, or a jump), on `now`'s clock: a focus set before then is not followed
  const lastCameraMove = useRef(0);
  const nowRef = useRef(now);
  nowRef.current = now;
  /** Every jump of the app's: remembers the place the camera leaves, then goes to the point */
  const jump = (point: Point, map = mapRef.current, label?: string): void => {
    const here = { map: mapRef.current, ...placeRef.current, label: label ?? areaRef.current ?? worldMapById(mapRef.current)?.name ?? '' };
    setBack((stack) => pushPlace(stack, here));
    lastCameraMove.current = nowRef.current();
    goTo(point, map);
  };
  const goBack = (): void => {
    const { place, stack } = popPlace(back);
    if (!place) return;
    setBack(stack);
    goTo({ x: place.x, y: place.y, z: place.z }, place.map);
  };
  const backRef = useRef(goBack);
  backRef.current = goBack;
  // A place left on a map the client holds (a dungeon, a transport) is only known once the client's maps are
  // read: the World opens there then, at the route and stop it was left at, unless the author went elsewhere first
  useEffect(() => {
    const saved = readSavedPlace();
    if (!saved || saved.map === first.map) return;
    let live = true;
    void mapsReady().then(() => {
      if (!live || mapRef.current !== first.map || !worldMapById(saved.map)) return;
      goTo({ x: saved.x, y: saved.y, z: saved.z }, saved.map);
      setChosenView(saved.transport);
      writeLastPlace(saved);
    });
    return () => {
      live = false;
    };
    // Once, for the place the World was opened with
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Picking a map in the Coordinates form already jumped (and remembered where from); the Go that
  // follows is part of the same move, so it does not remember the map's start as a place to go back to
  const mapPicked = useRef(false);
  const chooseMap = (id: number): void => {
    if (id === mapRef.current) return;
    mapPicked.current = true;
    jump(worldMapById(id)!.start, id);
  };
  const goFromForm = (point: Point): void => {
    if (mapPicked.current) goTo(point);
    else jump(point);
    mapPicked.current = false;
  };
  // Show on the undo note: the camera goes to where the step happened
  useEffect(() => {
    if (!goToRequest || !worldMapById(goToRequest.map)) return;
    jump(inWorld(goToRequest.map, { x: goToRequest.x, y: goToRequest.y, z: goToRequest.z }), goToRequest.map);
    // Only a new request moves the camera
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goToRequest?.nonce]);

  /**
   * Where a quest is, or the nearest spawn of one of its NPCs or objects: a spawn to go to, null when
   * nothing of it is placed, or why it could not be told.
   */
  const placeOf = async (target: ShowTarget): Promise<{ spawn: FoundSpawn | null; name?: string } | { error: string }> => {
    const from = { map: mapRef.current, ...asStored(mapRef.current, placeRef.current) };
    const only = 'kind' in target ? { kind: target.kind, entry: target.entry } : undefined;
    if (!api) return { error: NEEDS_DATABASE };
    // The client's other maps count as drawable once they are read
    await mapsReady();
    const read = await api.questSpawnList([target.questId]);
    if (!read.ok) {
      // Only an absent connection needs the database; any other failure says what went wrong
      return { error: read.error.code === 'NOT_CONNECTED' ? NEEDS_DATABASE : `Could not read the quest’s spawns: ${read.error.message}` };
    }
    const groups: QuestSpawnGroup[] = read.value;
    // A spawn on a map the World draws wins; the rest (an instance, say) are only named when nothing else is left
    const s = questPlace(groups.map((g) => ({ ...g, spawns: g.spawns.filter((sp) => worldMapById(sp.map)) })), from, only);
    // Nothing the project or the layer has: the database may still have it
    if (!s && groups.some((g) => g.offline)) return { error: NEEDS_DATABASE };
    if (!s) {
      const elsewhere = questPlace(groups, from, only);
      if (elsewhere) return { error: `${only ? giverName({ kind: only.kind, id: only.entry }, namesRef.current, storeRef.current) : 'This quest'} is on map ${elsewhere.map}, which the World cannot draw.` };
      return { spawn: null, ...(only && { name: giverName({ kind: only.kind, id: only.entry }, namesRef.current, storeRef.current) }) };
    }
    return { spawn: { kind: s.kind === 'gameobject' ? 'object' : 'creature', guid: s.guid, entry: s.entry, name: s.name, map: s.map, x: s.x, y: s.y, z: s.z, event: s.event ?? null, note: null } };
  };
  // The spawn the focus last led to, for selecting it once the camera is there
  const followed = useRef<FoundSpawn | null>(null);
  // The part this view selected and made the focus: that focus is not followed back to it
  const reported = useRef<FocusPart | null>(null);
  // The note the follow last put up, which the next focus takes back
  const followNote = useRef<string | null>(null);
  useFocusFollow({
    focus: shared,
    lastCameraMove: () => lastCameraMove.current,
    shown: hasClient,
    placeOf: async (target) => {
      const place = await placeOf(target);
      followed.current = 'spawn' in place ? place.spawn : null;
      return place;
    },
    jump: ({ map, ...point }) => jump(inWorld(map, point), map),
    select: ({ kind, guid }) => {
      const spawn = followed.current;
      if (!spawn || spawn.kind !== kind || spawn.guid !== guid || spawn.map !== mapRef.current) return;
      // The camera went to it, and closes in; one the author has moved away from is selected only while it is in view
      const seen = inWorld(spawn.map, spawn);
      const there = Math.hypot(seen.x - placeRef.current.x, seen.y - placeRef.current.y, seen.z - placeRef.current.z) <= 1;
      bringIntoView(spawn, !there);
    },
    note: (text) => {
      followNote.current = text;
      setNote(text);
    },
    // Only the follow's own note: one another action left meanwhile stays
    clearNote: () => {
      const mine = followNote.current;
      followNote.current = null;
      if (mine !== null) setNote((shown) => (shown === mine ? null : shown));
    },
    selected: () => {
      const part = reported.current;
      reported.current = null;
      return part;
    },
  });
  /** An NPC or object selected here (by a click or by Find) that plays a part in the open quest becomes the focus */
  const selectSpawn = (spawn: Pick<PickedSpawn, 'kind' | 'entry'> | null): void => {
    if (!spawn || !info || !onFocusPart) return;
    const part: FocusPart = { kind: spawn.kind === 'object' ? 'gameobject' : 'creature', entry: spawn.entry };
    if (!ROLES.some((role) => hasRole(info.roles, role, { kind: part.kind, id: part.entry }))) return;
    if (shared.questId === info.id && shared.part?.kind === part.kind && shared.part.entry === part.entry) return;
    reported.current = part;
    onFocusPart(info.id, part);
  };
  const teleport = (spot: TeleportSpot): void => {
    setTeleporting(false);
    jump({ x: spot.x, y: spot.y, z: spot.z }, spot.map);
  };
  /** Selects a spawn in the view and, unless it is to `stay`, takes the camera close to it */
  function bringIntoView(spawn: FoundSpawn, stay = false): void {
    setFocus((previous) => ({
      kind: spawn.kind, guid: spawn.guid, entry: spawn.entry, name: spawn.name, x: spawn.x, y: spawn.y, z: spawn.z,
      event: spawn.event, added: spawn.note === 'placed', stay, nonce: (previous?.nonce ?? 0) + 1,
    }));
  }
  const find = (spawn: FoundSpawn): void => {
    setFinding(false);
    jump(inWorld(spawn.map, spawn), spawn.map);
    bringIntoView(spawn);
    selectSpawn(spawn);
  };
  // A spawn group: the camera goes to the middle of its members, and its first spawn is focused
  const findGroup = (view: GroupView): void => {
    setFinding(false);
    const placed = view.members.filter((m) => m.at);
    if (placed.length > 0) {
      const mean = (axis: 'x' | 'y' | 'z'): number => placed.reduce((sum, m) => sum + m.at![axis], 0) / placed.length;
      jump(inWorld(view.map, { x: mean('x'), y: mean('y'), z: mean('z') }), view.map);
    }
    const first = view.members.find((m) => m.type === 'spawn' && m.at);
    const [prefix, guid] = first?.key.split(':') ?? [];
    if (first?.at && (prefix === 'npc' || prefix === 'object') && Number.isFinite(Number(guid))) {
      const at = first.at;
      setFocus((previous) => ({
        kind: prefix === 'npc' ? 'creature' : 'object', guid: Number(guid), entry: 0, name: first.name, x: at.x, y: at.y, z: at.z,
        event: null, added: false, nonce: (previous?.nonce ?? 0) + 1,
      }));
    }
  };

  const onRequestEndRef = useRef(onRequestEnd);
  onRequestEndRef.current = onRequestEnd;
  // The open quest's positions (scene steps, escorts, fight summons, areas, POIs) drawn as markers
  const markers = useQuestMarkers({
    values, entities: storeRef, map: mapId, change, runStep,
    setEntities: (next) => {
      storeRef.current = next;
      project?.setEntities(next);
    },
  });
  const [markerFocus, setMarkerFocus] = useState<MarkerFocus | undefined>();
  // What an editor asked to see (a quest position, a spawn, a quest or its part), until the author is done with it there
  const [showing, setShowing] = useState<string | null>(null);
  const endShowing = (): void => {
    setShowing(null);
    onRequestEndRef.current?.();
  };
  /** Show in World on a quest position: the camera goes to its marker, which is selected to drag */
  const showMarker = (id: string): void => {
    const marker = markers.all.find((m) => m.id === id);
    const map = marker ? (marker.map ?? mapRef.current) : null;
    if (!marker || map === null || !worldMapById(map)) {
      setNote(marker ? `${marker.label} is on a map the 3D view does not draw.` : 'That position is not in the open quest.');
      onRequestEndRef.current?.();
      return;
    }
    jump({ x: marker.x, y: marker.y, z: marker.z }, map);
    setMarkerFocus((was) => ({ id, nonce: (was?.nonce ?? 0) + 1 }));
    setShowing(`${marker.label}: drag its handles to move it.`);
  };
  // A quest closed while one of its positions is shown: there is nothing left to show
  const questOpen = quest !== undefined;
  useEffect(() => {
    if (!questOpen && showing !== null) endShowing();
    // Only the quest closing ends it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questOpen]);

  // An editor's request: placing starts, the camera goes to the exact spawn (and its patrol is drawn) or
  // quest position, or (Show in World, which the focus does) the World says what it is showing
  const [placeRequest, setPlaceRequest] = useState<{ kind: 'creature' | 'object'; entry: number; name: string; nonce: number } | undefined>();
  const [patrolRequest, setPatrolRequest] = useState<{ guid: number; name: string; nonce: number } | undefined>();
  useEffect(() => {
    const asked = request;
    if (!asked) return;
    setShowing(null);
    if (asked.kind === 'marker') {
      showMarker(asked.id);
      return;
    }
    if (asked.kind === 'show') {
      const { target } = asked;
      setShowing(`${'kind' in target ? giverName({ kind: target.kind, id: target.entry }, namesRef.current, storeRef.current) : questLabel(quest?.nodes ?? [], target.questId)}.`);
      return;
    }
    const kind = asked.kind === 'patrol' ? 'creature' : asked.kind === 'spawn' ? asked.spawn : asked.kind;
    const name = giverName({ kind: kind === 'object' ? 'gameobject' : 'creature', id: asked.entry }, namesRef.current, storeRef.current);
    if (asked.kind !== 'patrol' && asked.kind !== 'spawn') {
      setPlaceRequest((was) => ({ kind, entry: asked.entry, name, nonce: (was?.nonce ?? 0) + 1 }));
      return;
    }
    const spawn = ownSpawnOf(storeRef.current, kind, asked.entry, asked.guid, name);
    if (!spawn || !worldMapById(spawn.map)) {
      setNote(spawn ? `${name} stands on a map the 3D view does not draw.` : 'That spawn is no longer in the project.');
      onRequestEndRef.current?.();
      return;
    }
    find(spawn);
    if (asked.kind === 'patrol') setPatrolRequest((was) => ({ guid: spawn.guid, name, nonce: (was?.nonce ?? 0) + 1 }));
    else setShowing(`${name}.`);
    // Only a new request is acted on
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.nonce]);

  const parsed = { x: Number(typed.x), y: Number(typed.y), z: Number(typed.z) };
  const valid = [typed.x, typed.y, typed.z].every((v) => v.trim() !== '') && Object.values(parsed).every(Number.isFinite);

  // Esc closes this workspace's own panels, the top one first; it never leaves the world. The view
  // clears its own selection. Only keys pressed in the world are its own: one pressed in the quest dock
  // beside it, or in a dialog over the app, is left to that.
  const section = useRef<HTMLElement | null>(null);
  const panels = useRef({ finding, teleporting, coordinates, welcoming, leaveWelcome, preset });
  panels.current = { finding, teleporting, coordinates, welcoming, leaveWelcome, preset };
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const from = e.target instanceof Element ? e.target : null;
      if (from && from !== document.body && !section.current?.contains(from)) return;
      if (e.key === 'ArrowLeft' && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        const el = e.target instanceof HTMLElement ? e.target : null;
        if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return;
        e.preventDefault();
        backRef.current();
        return;
      }
      if (e.key !== 'Escape') return;
      const open = panels.current;
      if (open.preset) setPreset(null);
      else if (open.finding) setFinding(false);
      else if (open.teleporting) setTeleporting(false);
      else if (open.coordinates) setCoordinates(false);
      else if (open.welcoming) open.leaveWelcome();
      else return;
      e.stopPropagation();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, []);

  const mapName = worldMapById(mapId)?.name ?? '';

  if (!hasClient) {
    return (
      <section className="world-workspace" aria-label="World">
        <div className="world-empty">
          <div className="world-empty__orb" data-orb-target="">
            <QuestOrb />
          </div>
          <div className="world-empty__card glass">
            <h2 className="world-empty__title">See the world in 3D</h2>
            <p className="world-empty__text">
              The world is drawn from your own game client. Choose its folder in Settings to walk it, place NPCs and objects, and edit their routes.
            </p>
            <div className="world-empty__actions">
              <button type="button" className="btn btn--primary" onClick={onOpenSettings}>
                Open settings
              </button>
              <button type="button" className="btn" onClick={onShowQuests}>
                Go to Quests
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  const field = (axis: 'x' | 'y' | 'z'): React.JSX.Element => (
    <label className="scene-field world-place__coordinate">
      <span>{axis.toUpperCase()}</span>
      <input type="number" step="any" value={typed[axis]} onChange={(e) => setTyped((t) => ({ ...t, [axis]: e.target.value }))} />
    </label>
  );

  return (
    <section ref={section} className="world-workspace" aria-label="World">
      <World3DView
        map={mapId}
        start={at}
        hasClient
        focus={focus}
        onSelect={selectSpawn}
        showArea={false}
        onArea={setArea}
        onPlaceChange={(place) => {
          placeRef.current = place;
          remember(place);
        }}
        onCameraInput={() => {
          lastCameraMove.current = nowRef.current();
        }}
        own={own}
        onOwnEdit={
          project
            ? (edit) => {
                const next = ownEdit(storeRef.current, edit);
                if (next) {
                  storeRef.current = next;
                  project?.setEntities(next);
                }
                return next !== null;
              }
            : undefined
        }
        quest={info}
        chainIds={chainIds}
        onQuestRole={(role, target, on) => {
          const edits = values.current ? toggleRole(values.current, role, target, on) : null;
          if (!edits) return OBJECTIVES_FULL;
          for (const [fieldId, value] of Object.entries(edits)) change(fieldId, value);
          return null;
        }}
        onNewQuest={onNewQuest ? (giver, after) => onNewQuest(giver, after && quest ? quest.open.questId : null) : undefined}
        onOpenQuest={onOpenQuest}
        onShowSpawns={(groups, scope) => setPreset(presetOf(groups, scope))}
        onCreateEntity={createEntity}
        onEditEntity={(kind, entry) => void editEntity(kind, entry)}
        onGoToSpawn={({ map, ...target }) => {
          jump(inWorld(map, target), map);
          setFocus((previous) => ({ ...target, nonce: (previous?.nonce ?? 0) + 1 }));
        }}
        onSetLootable={setLootable}
        placeRequest={placeRequest}
        patrolRequest={patrolRequest}
        onRequestEnd={() => onRequestEndRef.current?.()}
        markers={markers.shown}
        onMarkerMove={markers.move}
        markerFocus={markerFocus}
        transport={transportMap && transportView ? { map: transportMap, view: transportView } : undefined}
        docks={docks}
      />
      {transportMap && transportView && (
        <TransportBar map={transportMap} view={transportView} hostName={(id) => worldMapById(id)?.name ?? `Map ${id}`} onView={chooseView} />
      )}
      {showing && (
        <p role="status" className="world3d__placing">
          Showing {showing}
          <button type="button" className="btn" onClick={endShowing}>
            Done
          </button>
        </p>
      )}
      {note && (
        <p className="world3d__note" role="status">
          {note}
          <button type="button" className="btn btn--icon" aria-label="Dismiss" onClick={() => setNote(null)}>
            ✕
          </button>
        </p>
      )}
      {editor && project && (
        <PlaceInWorldProvider value={editorPlace}>
        <ShowInWorldProvider value={editorShow}>
          <div className="modal-backdrop" hidden={editorAside}>
            <EntityEditorHost entities={project.entities} onChange={(next) => project.setEntities(next)} quests={project.quests} layer={project.layer}
              state={editor} onTab={(tab) => setEditor((was) => (was ? { ...was, tab } : was))} onClose={() => setEditor(null)}
              onDelete={(kind, entry) => project.remove(kind, entry)} />
          </div>
        </ShowInWorldProvider>
        </PlaceInWorldProvider>
      )}
      <section className="world-place glass" aria-label="Place">
        <h2 className="world-place__title">{area ?? mapName}</h2>
        {area && <p className="world-place__map section-label">{mapName}</p>}
        <div className="world-place__actions">
          <button type="button" className="btn btn--icon" aria-label="Back" title={back.length > 0 ? `Back to ${back[back.length - 1].label}` : 'Back'} disabled={back.length === 0} onClick={goBack}>
            ←
          </button>
          <button type="button" className="btn" onClick={() => setTeleporting(true)}>
            Teleport
          </button>
          <button type="button" className="btn" onClick={() => setFinding(true)}>
            Find…
          </button>
          <button type="button" className="btn" aria-expanded={coordinates} onClick={() => {
              mapPicked.current = false;
              setCoordinates((open) => !open);
            }}>
            Coordinates
          </button>
        </div>
        {coordinates && (
          <form
            className="world-place__coordinates"
            onSubmit={(e) => {
              e.preventDefault();
              if (!valid) return;
              goFromForm(parsed);
              setCoordinates(false);
            }}
          >
            <label className="scene-field world-place__map-field">
              <span>Map</span>
              <select value={mapId} onChange={(e) => chooseMap(Number(e.target.value))}>
                {groupWorldMaps(maps).map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.maps.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            {field('x')}
            {field('y')}
            {field('z')}
            <button type="submit" className="btn btn--primary" disabled={!valid}>
              Go
            </button>
          </form>
        )}
      </section>
      {(welcoming || fading) && (
        <Welcome
          projectName={projectName}
          leaving={!welcoming}
          onPick={(spot) => leaveWelcome(() => teleport(spot))}
          onFind={() => leaveWelcome(() => setFinding(true))}
          onStartQuest={() => leaveWelcome(onStartQuest)}
          onClose={() => leaveWelcome()}
        />
      )}
      {finding && <FindDialog from={{ map: mapId, ...asStored(mapId, at) }} onGo={find} onGoToGroup={findGroup} onClose={() => setFinding(false)} />}
      {preset && (
        <FindDialog
          from={{ map: mapId, ...asStored(mapId, at) }}
          preset={preset}
          onGo={(spawn) => {
            setPreset(null);
            find(spawn);
          }}
          onClose={() => setPreset(null)}
        />
      )}
      {teleporting && <TeleportDialog onPick={teleport} onClose={() => setTeleporting(false)} />}
    </section>
  );
}

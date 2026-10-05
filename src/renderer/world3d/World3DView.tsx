import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { assetUrl } from '@core/client/asset-url';
import { worldMapDirectory } from '@core/map/world-maps';
import { createWorld3D, type Scenery, type SelectionSummary, type World3D } from './world3d';
import type { Tool } from './controls';
import { FALLOFF_DEFAULT, FALLOFF_MAX, FALLOFF_MIN } from './scene/edit/falloff';
import { summaryText } from './summary';
import { useApi } from '../state/names';
import { useHistorySteps } from '../state/history-context';
import type { EventFilter, PickedSpawn, SpawnStatus, SpawnVisibility } from './scene/spawn/SpawnManager';
import type { ViewSpawns } from '@core/db/view-spawns';
import { chooseZ, floorCandidates } from '@core/map/floors';
import { EMPTY_WORLD, movementsOf, type Placement, type WorldLayer } from '@core/world/layer';
import type { SpawnEdit, SpawnRef } from './edits';
import { ProjectChanges } from './ProjectChanges';
import { useProjectEntities } from '../state/project-entities';
import { EMPTY_ENTITIES } from '@core/entities/model';
import { PlaceDialog, type Chosen } from './PlaceDialog';
import { OrbMark } from '../components/OrbMark';
import type { PlaceRequest } from './placing';
import { useWorldMenu } from './useWorldMenu';
import type { QuestMenuInfo } from './menu/model';
import type { Role, RoleTarget } from '@core/modules/quest-roles';
import type { QuestSpawnGroup } from '@shared/ipc';
import { looksOf } from '@core/entities/view-spawns';
import '../views/ProjectDialog.css';
import './world3d.css';

/** The camera's controls, as the help in the corner lists them. */
const CONTROLS: [string, string][] = [
  ['Right-drag', 'Look around'],
  ['Tab', 'Switch between Camera and Select'],
  ['Left-click', 'Select an NPC, an object or a point of a shown route'],
  ['Left-drag', 'Camera: orbit round the point under the cursor. Select: select with a box'],
  ['Shift-click', 'Camera: add a point to the selected NPC’s route. Select: add to the selection'],
  ['Ctrl-click', 'Select: take from the selection'],
  ['Alt+drag', 'Select: orbit'],
  ['Alt+click', 'Select: add a route point'],
  ['G / R', 'Move or rotate the selection'],
  ['O', 'Falloff: nearby route points follow a move'],
  ['[ / ]', 'Falloff radius'],
  ['Place…', 'Choose an existing NPC or object, then click the ground'],
  ['Delete', 'Remove the selected route points'],
  ['Ctrl+Z / Ctrl+Y', 'Undo and redo'],
  ['Right-click', 'Menu: place, copy, paste, paths, quest'],
  ['Ctrl+C / Ctrl+V / Ctrl+D', 'Copy, paste under the cursor, duplicate'],
  ['Enter / Esc', 'While drawing a path: finish it'],
  ['Esc', 'Stop placing, or clear the selection'],
  ['Middle-drag', 'Pan'],
  ['Wheel', 'Move forward and back'],
  ['W / S', 'Fly forward and back'],
  ['A / D', 'Strafe left and right'],
  ['Q / E', 'Turn left and right'],
  ['Space / X', 'Rise and sink'],
  ['Shift', 'Faster'],
];

/** Where the layer checkboxes are remembered, per viewer. */
const LAYERS_KEY = 'acqc.world3d.layers';
/**
 * What the layers card shows: the world's scenery, its NPCs, objects and their paths, and the game
 * event it is drawn during (with that event's name, kept so the choice reads right out of its range)
 */
type Layers = SpawnVisibility & Scenery & { eventName?: string; tool: Tool; falloff: boolean; falloffRadius: number };
/** No event: the everyday world. Event spawns are only in the world while their event runs. */
const DEFAULT_LAYERS: Layers = {
  buildings: true, doodads: true, creatures: true, objects: true, paths: true, events: 'none', tool: 'camera', falloff: false, falloffRadius: FALLOFF_DEFAULT,
};
type Toggle = 'buildings' | 'doodads' | 'creatures' | 'objects' | 'paths';
const LAYER_LABELS: [Toggle, string, string?][] = [
  ['buildings', 'Buildings', 'Houses, towers and what is inside them. Hidden, clicks land on the ground under them'],
  ['doodads', 'Trees & props', 'Trees, bushes, fences, carts and the rest of the small scenery'],
  ['creatures', 'NPCs'],
  ['objects', 'Objects'],
  ['paths', 'Paths'],
];

const spawnsOf = ({ creatures, objects, paths, events }: Layers): SpawnVisibility => ({ creatures, objects, paths, events });
const sceneryOf = ({ buildings, doodads }: Layers): Scenery => ({ buildings, doodads });

/** An event filter as saved: the old checkbox's true is all events, its false no event; anything unknown is no event */
const eventFilterOf = (saved: unknown): EventFilter =>
  saved === true || saved === 'all' ? 'all' : typeof saved === 'number' && Number.isInteger(saved) && saved > 0 ? saved : 'none';

function readLayers(): Layers {
  try {
    const saved = JSON.parse(localStorage.getItem(LAYERS_KEY) ?? 'null') as (Partial<Omit<Layers, 'events'>> & { events?: unknown }) | null;
    const radius = saved?.falloffRadius;
    return {
      ...DEFAULT_LAYERS,
      ...(saved ?? {}),
      events: eventFilterOf(saved?.events),
      tool: saved?.tool === 'select' ? 'select' : 'camera',
      falloff: saved?.falloff === true,
      falloffRadius: typeof radius === 'number' && Number.isFinite(radius) && radius >= FALLOFF_MIN && radius <= FALLOFF_MAX ? radius : FALLOFF_DEFAULT,
    };
  } catch {
    return { ...DEFAULT_LAYERS };
  }
}

/** What the view says about the spawns: capped kinds, or why there are none. */
function spawnNote(status: SpawnStatus | null): string | null {
  if (!status) return null;
  if (status.error) return `NPCs and objects need the world database: ${status.error}`;
  const capped = [status.capped.creatures && 'Showing the first 2000 NPCs here', status.capped.objects && 'Showing the first 2000 objects here'].filter(Boolean);
  return capped.length > 0 ? capped.join('. ') : null;
}

/** How long the world may load before the view says it is taking too long. */
const SLOW_MS = 25000;

interface ViewProps {
  map: number;
  start: { x: number; y: number; z: number };
  hasClient: boolean;
  /** The project's own NPCs and objects, drawn with the world's. */
  own?: ViewSpawns;
  /** Told which NPC or object was clicked in the view, or null when the selection was cleared. */
  onSelect?(spawn: PickedSpawn | null): void;
  /** Takes edits to the project's own spawns, false when it could not; without it, every edit goes to the world layer. */
  onOwnEdit?(edit: SpawnEdit): boolean | void;
  /** A spawn to bring into view: the camera goes close to it and it is selected. Its map is `map`. */
  focus?: FocusTarget;
  /** False while the view is hidden: the world stops drawing until it is shown again. True by default. */
  active?: boolean;
  /** Whether the view labels the area itself; a host that names it elsewhere turns this off. True by default. */
  showArea?: boolean;
  /** Told the name of the area the camera is over, and null while a new world starts. */
  onArea?(name: string | null): void;
  /** Told where the camera rests (the point it looks at) once it has moved more than a yard. */
  onPlaceChange?(place: { x: number; y: number; z: number }): void;
  /** The open quest, for the right-click menu's quest items; none leaves them out. */
  quest?: QuestMenuInfo;
  /** The quests of the open quest's chain, for showing the chain's spawns. */
  chainIds?: number[];
  /** Gives an NPC or object a part in the open quest, or takes it away; says why when it could not. */
  onQuestRole?(role: Role, target: RoleTarget, on: boolean): string | null;
  /** The right-click menu's New … here: one project NPC or object with a spawn at `at`, as one step */
  onCreateEntity?(what: 'creature' | 'object', at: Placement): Promise<void>;
  /** The right-click menu's Edit NPC… / Edit object…, and Edit in Project changes (which lists items too) */
  onEditEntity?(kind: 'creature' | 'object' | 'item', entry: number): void;
  /** Project changes' Go to: brings a spawn of the project's into view, on whichever map it is */
  onGoToSpawn?(target: Omit<FocusTarget, 'nonce'> & { map: number }): void;
  /** The right-click menu's Make lootable… / Stop being lootable */
  onSetLootable?(entry: number, on: boolean): Promise<void>;
  /** Starts a new quest given and taken back by an NPC; `after` puts it after the open quest in its chain. */
  onNewQuest?(giver: { entry: number; name: string }, after: boolean): void;
  /** Told the spawns of the open quest or its chain, when they are shown, to list them. */
  onShowSpawns?(groups: QuestSpawnGroup[], scope: 'quest' | 'chain'): void;
}

/** How often the view checks where the camera rests, and how far it must move to count */
const PLACE_CHECK_MS = 2000;
const PLACE_MOVE = 1;

/** A spawn to bring into view: the camera goes to it, it is selected, and what hides it is switched on. */
export interface FocusTarget {
  kind: 'creature' | 'object';
  guid: number;
  entry: number;
  name: string;
  x: number;
  y: number;
  z: number;
  /** The game event it appears only during, so event spawns are shown */
  event: { id: number; name: string } | null;
  /** One placed in the 3D view */
  added: boolean;
  /** Told apart from an earlier focus on the same spawn, which is to be done again */
  nonce: number;
}

/** A route others walk too, waiting for the author to say whether to change it for all of them */
type SharedRoute = { pathId: number; walkers: number; answer(yes: boolean): void };

/**
 * The 3D view of one map, looking at a point. It needs the game client's folder (the terrain and
 * models are read from it) and a map the client has terrain for. Whatever goes wrong inside it stays
 * inside it: the rest of the app keeps running.
 */
export function World3DView(props: ViewProps): React.JSX.Element {
  return (
    <Contained>
      <WorldStage {...props} />
    </Contained>
  );
}

class Contained extends Component<{ children: ReactNode }, { failure: string | null }> {
  state = { failure: null as string | null };
  static getDerivedStateFromError(error: unknown): { failure: string } {
    return { failure: error instanceof Error ? error.message : String(error) };
  }
  render(): ReactNode {
    if (this.state.failure === null) return this.props.children;
    return (
      <div className="world3d" aria-label="3D view">
        <p role="alert" className="world3d__note">
          The 3D view stopped: {this.state.failure}{' '}
          <button type="button" className="btn" onClick={() => this.setState({ failure: null })}>
            Try again
          </button>
        </p>
      </div>
    );
  }
}

function WorldStage({
  map, start, hasClient, own, onSelect, onOwnEdit, focus, active = true, showArea = true, onArea, onPlaceChange, quest, chainIds, onQuestRole, onNewQuest, onShowSpawns,
  onCreateEntity, onEditEntity, onSetLootable, onGoToSpawn,
}: ViewProps): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null);
  const world = useRef<World3D | null>(null);
  const startRef = useRef(start);
  startRef.current = start;
  const [area, setArea] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [missing, setMissing] = useState<readonly string[]>([]);
  const [status, setStatus] = useState<'loading' | 'slow' | 'ready'>('loading');
  const [help, setHelp] = useState(false);
  const [layers, setLayers] = useState<Layers>(readLayers);
  const [spawns, setSpawns] = useState<SpawnStatus | null>(null);
  const [selected, setSelected] = useState<PickedSpawn | null>(null);
  // How much is selected, as the world last said
  const [summary, setSummary] = useState<SelectionSummary | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onOwnEditRef = useRef(onOwnEdit);
  onOwnEditRef.current = onOwnEdit;
  const onAreaRef = useRef(onArea);
  onAreaRef.current = onArea;
  const onPlaceChangeRef = useRef(onPlaceChange);
  onPlaceChangeRef.current = onPlaceChange;
  const activeRef = useRef(active);
  activeRef.current = active;
  // A spawn to bring into view; kept until the world that is to show it is there (a map switch builds a new one)
  const pendingFocus = useRef<FocusTarget | null>(null);
  // The world layer as the main process last gave it, drawn over the database
  const [layer, setLayer] = useState<WorldLayer>(EMPTY_WORLD);
  const layerRef = useRef<WorldLayer>(EMPTY_WORLD);
  // What the last edit said (an error, a height not from the server), shown with the selection
  const [note, setNote] = useState<string | null>(null);
  const [shared, setShared] = useState<SharedRoute | null>(null);
  const [changesOpen, setChangesOpen] = useState(false);
  const project = useProjectEntities();
  const projectEntities = project?.entities;
  const setProjectLayer = useRef(project?.setLayer);
  setProjectLayer.current = project?.setLayer;
  const changes = layer.spawns.length + layer.routes.length + layer.added.length + movementsOf(layer).length
    + (projectEntities ? projectEntities.npcs.length + projectEntities.objects.length + projectEntities.items.length : 0);
  // Choosing an existing NPC or object to place, and the one being placed (each click on the ground puts one down)
  const [choosing, setChoosing] = useState(false);
  const [placing, setPlacing] = useState<Chosen | null>(null);
  /** A layer from the Project changes list (after a revert): kept and drawn */
  const takeLayer = (next: WorldLayer): void => {
    layerRef.current = next;
    setLayer(next);
    setProjectLayer.current?.(next);
    world.current?.setWorldLayer(next);
  };
  // An undo or redo changed the world layer: a drag under way is dropped first, then the layer is drawn
  const { worldLayer: undone, runStep, hold } = useHistorySteps();
  const runStepRef = useRef(runStep);
  runStepRef.current = runStep;
  const holdRef = useRef(hold);
  holdRef.current = hold;
  const seenSeq = useRef(undone?.seq ?? 0);
  useEffect(() => {
    if (!undone || undone.seq === seenSeq.current) return;
    seenSeq.current = undone.seq;
    world.current?.cancelDrag();
    takeLayer(undone.layer);
    // takeLayer only writes refs and state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undone]);
  /** Takes the camera close to the pending focus and selects it, with the layers that would hide it on */
  const bringIntoView = (): void => {
    const target = pendingFocus.current;
    const current = world.current;
    if (!target || !current) return;
    pendingFocus.current = null;
    // An event spawn is shown by drawing the world during its event (all events already show it)
    setLayers((l) => ({
      ...l,
      [target.kind === 'creature' ? 'creatures' : 'objects']: true,
      ...(target.event && l.events !== 'all' && l.events !== target.event.id ? { events: target.event.id, eventName: target.event.name } : {}),
    }));
    current.lookAt(target.x, target.y, target.z + 1, true);
    current.select({ kind: target.kind, guid: target.guid });
    setSelected({
      kind: target.kind, guid: target.guid, entry: target.entry, name: target.name, own: false, added: target.added, pathId: 0,
      event: target.event, position: { x: target.x, y: target.y, z: target.z },
    });
    setNote(null);
  };
  const bringIntoViewRef = useRef(bringIntoView);
  bringIntoViewRef.current = bringIntoView;
  const api = useApi();
  const apiRef = useRef(api);
  apiRef.current = api;
  const layersRef = useRef(layers);
  layersRef.current = layers;
  const ownRef = useRef(own);
  ownRef.current = own;
  // A stable key, so the world is told only when the quest's spawns really change
  const ownKey = JSON.stringify(own ?? null);
  const directory = worldMapDirectory(map);
  const mapRef = useRef(map);
  mapRef.current = map;
  // Edits as the view sends them, set by the world that is up; paths started here, which the database lacks
  const sendRef = useRef<(change: SpawnEdit) => Promise<boolean>>(async () => false);
  const newPaths = useRef(new Set<number>());
  /** A path the database does not have: started here, or found in the layer made from nothing (before a restart) */
  const isNewPath = (pathId: number): boolean => newPaths.current.has(pathId) || layerRef.current.routes.some((r) => r.pathId === pathId && r.original.length === 0);
  /** The server's floor nearest a height at a place on this map, or null when it has none there */
  const floorAt = async (x: number, y: number, nearZ: number): Promise<number | null> => {
    const answer = await apiRef.current?.mapFloors(mapRef.current, x, y);
    if (!answer?.ok || 'reason' in answer.value) return null;
    return chooseZ(floorCandidates(answer.value), nearZ);
  };
  const menu = useWorldMenu({
    world,
    api,
    map,
    active,
    send: (change) => sendRef.current(change),
    takeLayer: (next) => takeLayer(next),
    setNote,
    floorZ: floorAt,
    placing: placing !== null,
    stopPlacing: () => setPlacing(null),
    clearSelection: () => clearSelection(),
    focusView: () => container.current?.querySelector('canvas')?.focus(),
    viewCentre: () => {
      const rect = container.current?.getBoundingClientRect();
      return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : { x: 0, y: 0 };
    },
    newPaths: newPaths.current,
    isNewPath,
    quest,
    chainIds,
    onOwnEdit,
    onQuestRole,
    onNewQuest,
    onShowSpawns,
    onCreateEntity,
    onEditEntity,
    onSetLootable,
    entities: projectEntities ?? EMPTY_ENTITIES,
  });
  const menuRef = useRef(menu);
  menuRef.current = menu;

  useEffect(() => {
    const element = container.current;
    if (!element || !directory || !hasClient) return;
    setProblem(null);
    setArea(null);
    onAreaRef.current?.(null);
    setMissing([]);
    setStatus('loading');
    setSelected(null);
    setSummary(null);
    setNote(null);
    setPlacing(null);
    let live = true;
    // One gesture's edits go to the main process one after another: each answer is a whole new
    // layer, so an earlier, slower answer must never replace a later one
    let queue: Promise<void> = Promise.resolve();
    // World edits sent and not yet answered. Each answer is the whole layer, so only the last one of a
    // gesture is drawn: an earlier one would draw the gesture's later spawns back where they were
    let waiting = 0;
    let created: World3D | null = null;
    // Each route's answer to "change it for everyone who walks it?", for as long as this world lives
    const answers = new Map<number, Promise<boolean>>();
    const applyLayer = (next: WorldLayer): void => {
      layerRef.current = next;
      setLayer(next);
      setProjectLayer.current?.(next);
      created?.setWorldLayer(next);
    };
    // The card follows the selected spawn to where an edit put it
    const placed = (change: SpawnEdit): void => {
      if (change.kind !== 'place') return;
      const { kind, guid } = change.spawn;
      const { x, y, z } = change.to;
      setSelected((s) => (s && s.kind === kind && s.guid === guid ? { ...s, position: { x, y, z } } : s));
    };
    // Own spawns go to the quest; the rest to the world layer, and a refused edit is drawn back
    // Whether the edit was kept
    const edit = async (change: SpawnEdit): Promise<boolean> => {
      if (change.spawn.own && onOwnEditRef.current) {
        if (onOwnEditRef.current(change) === false) return false;
        placed(change);
        return true;
      }
      const current = apiRef.current;
      if (!current) return false;
      const kind = change.spawn.kind === 'object' ? 'gameobject' : 'creature';
      const points = change.kind === 'route' ? change.points.map((p) => ({ x: p.x, y: p.y, z: p.z, rest: (p.carry as Record<string, string | null> | undefined) ?? {} })) : [];
      const result =
        change.kind === 'place' ? await current.worldMoveSpawn(kind, change.spawn.guid, change.to)
        : change.kind === 'movement' ? await current.worldSetMovement(change.spawn.guid, change.to)
        // A spawn put back by a redo keeps its guid; one taken away by an undo leaves the layer
        : change.kind === 'presence'
          ? change.present
            ? await current.worldAddSpawn(kind, change.spawn.entry, change.map, change.at, change.spawn.guid).then((r) => (r.ok ? { ok: true as const, value: r.value.layer } : r))
            : await current.worldRevert({ kind: 'spawn', spawnKind: kind, guid: change.spawn.guid })
        // A path made in this view is not in the database
        : isNewPath(change.pathId) ? await current.worldSetRoute(change.pathId, points, { isNew: true })
        : await current.worldSetRoute(change.pathId, points);
      if (!live) return false;
      if (!result.ok) {
        setNote(result.error.message);
        return false;
      }
      // Kept, and drawn once the gesture's last answer is in
      layerRef.current = result.value;
      setLayer(result.value);
      placed(change);
      setNote(null);
      return true;
    };
    // A click while placing: the spawn goes into the world layer, and is selected so it can be turned or moved at once
    const place = async ({ target, at }: PlaceRequest): Promise<void> => {
      const current = apiRef.current;
      if (!current) return;
      const kind = target.kind === 'object' ? 'gameobject' : 'creature';
      const result = await current.worldAddSpawn(kind, target.entry, map, at);
      if (!live) return;
      if (!result.ok) {
        setNote(result.error.message);
        return;
      }
      applyLayer(result.value.layer);
      const { guid } = result.value;
      const added = result.value.layer.added.find((a) => a.kind === kind && a.guid === guid);
      created?.select({ kind: target.kind, guid });
      setSelected({
        kind: target.kind, guid, entry: target.entry, name: added?.name ?? '', own: false, added: true, pathId: 0, event: null,
        position: { x: at.x, y: at.y, z: at.z },
      });
      setNote(null);
    };
    const floorZ = floorAt;
    // The quest's own edits are taken at once; world edits wait their turn. One that fails outright is
    // said, and the queue goes on
    const send = (change: SpawnEdit): Promise<boolean> => {
      if (change.spawn.own && onOwnEditRef.current) return edit(change);
      waiting += 1;
      const kept = queue
        .then(() => edit(change))
        .catch((error: unknown) => {
          if (live) setNote(`The change could not be kept: ${error instanceof Error ? error.message : String(error)}`);
          return false;
        })
        .finally(() => {
          waiting -= 1;
          // The last answer: the layer as the main process now has it (a refused edit is drawn back)
          if (waiting === 0 && live) created?.setWorldLayer(layerRef.current);
        });
      queue = kept.then(() => undefined);
      return kept;
    };
    sendRef.current = send;
    const beforeRouteEdit = (spawn: SpawnRef, pathId: number): Promise<boolean> => {
      if (spawn.own) return Promise.resolve(true);
      let answer = answers.get(pathId);
      if (!answer) {
        answer = (async () => {
          const route = await apiRef.current?.worldRoute(pathId);
          if (!route?.ok || route.value.walkers <= 1) return true;
          const walkers = route.value.walkers;
          return new Promise<boolean>((resolve) => setShared({ pathId, walkers, answer: resolve }));
        })();
        answers.set(pathId, answer);
      }
      return answer;
    };
    const slow = setTimeout(() => live && setStatus((s) => (s === 'loading' ? 'slow' : s)), SLOW_MS);
    // The client may not have this map's terrain (a server-only map, a folder that is not a client):
    // say so, instead of drawing an empty world.
    void fetch(assetUrl(`world/maps/${directory}/${directory}.wdt`))
      .then((r) => r.ok)
      .catch(() => false)
      .then((found) => {
        if (!live) return;
        if (!found) {
          setProblem('The game client has no terrain for this map. Check the game client folder in the connection settings.');
          return;
        }
        try {
          created = createWorld3D({
            container: element,
            directory,
            map,
            start: startRef.current,
            onArea: (name) => {
              setArea(name);
              onAreaRef.current?.(name);
            },
            onReady: () => live && setStatus('ready'),
            onProblems: (all) => live && setMissing(all),
            onError: setProblem,
            onSelect: (spawn) => {
              if (!live) return;
              setSelected(spawn);
              setNote(null);
              onSelectRef.current?.(spawn);
            },
            // One gesture is one step of the project's history, its own and world edits alike
            onGesture: (changes) =>
              void runStepRef.current(async () => {
                for (const change of changes) await send(change);
              }),
            onContextMenu: (target, client) => live && menuRef.current.open(target, client),
            onDrawing: (drawing) => live && menuRef.current.onDrawing(drawing),
            onShortcut: (code) => live && menuRef.current.shortcut(code),
            onSelection: (next) => live && setSummary(next),
            onTool: (tool) => live && setLayers((l) => ({ ...l, tool })),
            onFalloff: (falloff) => live && setLayers((l) => ({ ...l, falloff: falloff.on, falloffRadius: falloff.radius })),
            floorZ,
            beforeRouteEdit,
            onNotice: (message) => live && setNote(message),
            onPlace: (request) => void runStepRef.current(() => place(request)),
            // A gesture waiting for the floor holds undo, so Ctrl+Z takes it back rather than the step before
            onGestureStart: () => holdRef.current(),
            onPlaceEnd: () => live && setPlacing(null),
            spawns: async (spawnMap, box) => {
              const current = apiRef.current;
              if (!current) return { error: 'the app is not connected' };
              const result = await current.viewSpawns(spawnMap, box);
              return result.ok ? result.value : { error: result.error.message };
            },
          });
          created.setSpawnVisibility(spawnsOf(layersRef.current));
          created.setScenery(sceneryOf(layersRef.current));
          created.setTool(layersRef.current.tool);
          created.setFalloff({ on: layersRef.current.falloff, radius: layersRef.current.falloffRadius });
          if (!activeRef.current) created.setActive(false);
          if (looksRef.current.size > 0) created.setLooks(looksRef.current);
          if (ownRef.current) created.setOwnSpawns(ownRef.current);
          world.current = created;
          bringIntoViewRef.current();
          void apiRef.current?.worldLayer().then((result) => live && result.ok && applyLayer(result.value));
        } catch (error) {
          // Inside a promise, so an error boundary would not see it (no WebGL, say).
          setProblem(`The 3D view could not start: ${error instanceof Error ? error.message : String(error)}`);
        }
      });
    return () => {
      // A path being drawn is not left half made: it is put back as it was
      created?.cancelPath();
      live = false;
      clearTimeout(slow);
      created?.dispose();
      world.current = null;
    };
  }, [directory, map, hasClient]);

  // Edited existing NPCs and objects, drawn with their new look
  const looks = useMemo(() => looksOf(projectEntities ?? EMPTY_ENTITIES), [projectEntities]);
  const looksKey = JSON.stringify([...looks]);
  const looksSet = useRef(false);
  const looksRef = useRef(looks);
  looksRef.current = looks;
  useEffect(() => {
    if (looksRef.current.size === 0 && !looksSet.current) return;
    looksSet.current = looksRef.current.size > 0;
    world.current?.setLooks(looksRef.current);
  }, [looksKey]);

  // The open quest's own spawns, redrawn as they change.
  useEffect(() => {
    if (ownRef.current) world.current?.setOwnSpawns(ownRef.current);
  }, [ownKey]);

  // The layer checkboxes: applied to the world and remembered.
  useEffect(() => {
    world.current?.setSpawnVisibility(spawnsOf(layers));
    world.current?.setScenery(sceneryOf(layers));
    world.current?.setTool(layers.tool);
    world.current?.setFalloff({ on: layers.falloff, radius: layers.falloffRadius });
    try {
      localStorage.setItem(LAYERS_KEY, JSON.stringify(layers));
    } catch {
      // Storage unavailable: the choice lasts for this view only.
    }
  }, [layers]);

  // What is being placed, told to the world
  useEffect(() => {
    world.current?.setPlacing(placing ? { kind: placing.kind, entry: placing.entry } : null);
  }, [placing]);

  /** Takes a spawn placed in this view back out of the world layer */
  async function removePlaced(spawn: PickedSpawn): Promise<void> {
    const result = await api?.worldRevert({ kind: 'spawn', spawnKind: spawn.kind === 'object' ? 'gameobject' : 'creature', guid: spawn.guid });
    if (!result) return;
    if (!result.ok) {
      setNote(result.error.message);
      return;
    }
    takeLayer(result.value);
    clearSelection();
  }

  function clearSelection(): void {
    world.current?.select(null);
    setSelected(null);
    setSummary(null);
    onSelectRef.current?.(null);
  }

  // A hidden view stops drawing
  useEffect(() => {
    world.current?.setActive(active);
  }, [active]);

  // Where the camera rests, told to the host once it has moved far enough to matter
  useEffect(() => {
    let last: { x: number; y: number; z: number } | null = null;
    const timer = setInterval(() => {
      const at = world.current?.target();
      if (!at || !onPlaceChangeRef.current) return;
      if (last && Math.hypot(at.x - last.x, at.y - last.y, at.z - last.z) <= PLACE_MOVE) return;
      last = { x: at.x, y: at.y, z: at.z };
      onPlaceChangeRef.current(last);
    }, PLACE_CHECK_MS);
    return () => clearInterval(timer);
  }, []);

  // What the spawn source said last: capped kinds, or why there are none.
  useEffect(() => {
    const timer = setInterval(() => {
      const status = world.current?.spawnStatus() ?? null;
      setSpawns((previous) => (JSON.stringify(previous) === JSON.stringify(status) ? previous : status));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // A different point to look at (another marker chosen) moves the camera without rebuilding the world.
  useEffect(() => {
    world.current?.lookAt(start.x, start.y, start.z);
  }, [start.x, start.y, start.z]);

  // Bring a spawn into view (after the effect above, so the close camera is the one that stays): now, or once the world for its map is there
  useEffect(() => {
    if (!focus) return;
    pendingFocus.current = focus;
    bringIntoViewRef.current();
  }, [focus]);

  // The events with spawns near the camera, and the one chosen even when its spawns are out of range
  const nearbyEvents = spawns?.events ?? [];
  const chosen = typeof layers.events === 'number' && !nearbyEvents.some((e) => e.id === layers.events) ? [{ id: layers.events, name: layers.eventName ?? '' }] : [];
  const eventChoices = [...nearbyEvents, ...chosen];

  /** A click on a tool leaves the keyboard with the view, so Tab, G and R still reach it */
  const keepFocus = (event: React.MouseEvent): void => event.preventDefault();

  // More than one spawn, or any route points: the card sums them up instead of showing one spawn
  const several = summary !== null && summary.creatures + summary.objects + summary.points > 0 && !(summary.creatures + summary.objects === 1 && summary.points === 0);

  const unavailable = !hasClient
    ? 'Choose the game client folder in the connection settings to see the world in 3D.'
    : !directory
      ? 'The 3D view draws the four continents; this map is not one of them.'
      : null;
  const progress = unavailable || problem || status === 'ready' ? null : status === 'slow'
    ? 'Still nothing drawn. The terminal running the app lists any game client files it could not find.'
    : 'Loading the world…';

  return (
    <div className="world3d" aria-label="3D view">
      <div ref={container} className="world3d__stage" />
      {showArea && area && <p className="world3d__area">{area}</p>}
      {missing.length > 0 && (
        <p className="world3d__missing" title={missing.join('\n')}>
          {missing.length === 1 ? '1 thing' : `${missing.length} things`} could not be loaded and {missing.length === 1 ? 'is' : 'are'} left out:{' '}
          {missing.slice(0, 2).join('; ')}
          {missing.length > 2 ? '; …' : ''} (all of them are in the console)
        </p>
      )}
      {!unavailable && (
        <fieldset className="world3d__layers glass" aria-label="Layers">
          <legend className="section-label">Layers</legend>
          {LAYER_LABELS.map(([key, label, title]) => (
            <label key={key} title={title}>
              <input type="checkbox" checked={layers[key]} onChange={(e) => setLayers((l) => ({ ...l, [key]: e.target.checked }))} />
              {label}
            </label>
          ))}
          <label className="world3d__event" title="The game event the world is drawn during: its NPCs and objects appear, and those it takes away go">
            <span>Event</span>
            <select
              value={String(layers.events)}
              onChange={(e) => {
                const value = e.target.value;
                const events: EventFilter = value === 'none' || value === 'all' ? value : Number(value);
                const name = typeof events === 'number' ? eventChoices.find((c) => c.id === events)?.name : undefined;
                setLayers((l) => ({ ...l, events, eventName: name }));
              }}
            >
              <option value="none">No event</option>
              {eventChoices.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.name || `Event ${choice.id}`}
                </option>
              ))}
              <option value="all">All events</option>
            </select>
          </label>
          <div className="world3d__layers-actions">
            <button type="button" className="btn" disabled={!api} title="Choose an existing NPC or object, then click the ground to place it" onClick={() => setChoosing(true)}>
              Place…
            </button>
            <button type="button" className="btn" disabled={changes === 0} onClick={() => setChangesOpen(true)}>
              Project changes ({changes})
            </button>
          </div>
        </fieldset>
      )}
      {!unavailable && (
        <div className="world3d__tools glass" role="toolbar" aria-label="Tools">
          <button type="button" className="world3d__tool" onMouseDown={keepFocus} aria-pressed={layers.tool === 'camera'} title="Camera: left-drag orbits (Tab)" onClick={() => setLayers((l) => ({ ...l, tool: 'camera' }))}>
            Camera
          </button>
          <button type="button" className="world3d__tool" onMouseDown={keepFocus} aria-pressed={layers.tool === 'select'} title="Select: left-drag draws a box, Alt+drag orbits (Tab)" onClick={() => setLayers((l) => ({ ...l, tool: 'select' }))}>
            Select
          </button>
          {layers.tool === 'select' && (
            <button
              type="button"
              className="world3d__tool"
              onMouseDown={keepFocus}
              aria-pressed={layers.falloff}
              title="Nearby route points follow a move (O; [ and ] change the radius)"
              onClick={() => setLayers((l) => ({ ...l, falloff: !l.falloff }))}
            >
              Falloff {Math.round(layers.falloffRadius)} yd
            </button>
          )}
        </div>
      )}
      {!unavailable && placing && (
        <p role="status" className="world3d__placing">
          Placing {placing.name || `${placing.kind === 'creature' ? 'NPC' : 'object'} ${placing.entry}`} (#{placing.entry}): click the ground to put one down. Esc stops.
          <button type="button" className="btn" onClick={() => setPlacing(null)}>
            Done
          </button>
        </p>
      )}
      {choosing && api && (
        <PlaceDialog
          onPick={(chosen) => {
            setChoosing(false);
            setPlacing(chosen);
            // Focus back on the view, so Esc and the keys are its own again
            container.current?.querySelector('canvas')?.focus();
          }}
          onClose={() => setChoosing(false)}
        />
      )}
      {!unavailable && selected && !several && <SelectedSpawn spawn={selected} note={note} onClose={clearSelection} onRemove={selected.added ? () => void removePlaced(selected) : undefined} />}
      {!unavailable && several && summary && (
        <section className="world3d__selected" aria-label="Selection">
          <header>
            <h3>{summaryText(summary)}</h3>
          </header>
          {note && <p className="world3d__selected-note">{note}</p>}
          <p className="world3d__selected-actions">
            <button type="button" className="btn" onClick={clearSelection}>
              Clear
            </button>
          </p>
        </section>
      )}
      {!unavailable && !selected && !several && note && (
        <p role="status" className="world3d__edit-note">
          {note}
        </p>
      )}
      {changesOpen && api && (
        <ProjectChanges
          api={api}
          onLayer={takeLayer}
          onClose={() => setChangesOpen(false)}
          layerSeq={undone?.seq ?? 0}
          onEdit={onEditEntity ? (kind, entry) => onEditEntity(kind === 'npc' ? 'creature' : kind, entry) : undefined}
          onGoTo={
            onGoToSpawn
              ? (spawn) => {
                  setChangesOpen(false);
                  const entity = project?.tracked.find((t) => t.goTo === spawn);
                  onGoToSpawn({ kind: spawn.kind, guid: spawn.guid, entry: entity?.entry ?? 0, name: entity?.name ?? '', map: spawn.map, x: spawn.x, y: spawn.y, z: spawn.z, event: null, added: false });
                }
              : undefined
          }
        />
      )}
      {!unavailable && menu.elements}
      {shared && (
        <SharedRouteDialog
          shared={shared}
          onAnswer={(yes) => {
            shared.answer(yes);
            setShared(null);
          }}
        />
      )}
      {!unavailable && spawnNote(spawns) && <p className="world3d__spawn-note">{spawnNote(spawns)}</p>}
      {!unavailable && (spawns?.loading ?? 0) > 0 && (
        <p role="status" className="world3d__loading">
          <OrbMark size={16} spinning />
          Loading NPCs and objects… ({spawns!.loading} {spawns!.loading === 1 ? 'area' : 'areas'})
        </p>
      )}
      {!unavailable && (
        <div className="world3d__help">
          {help && (
            <dl aria-label="Camera controls" className="world3d__help-list">
              {CONTROLS.map(([input, does]) => (
                <div key={input}>
                  <dt>{input}</dt>
                  <dd>{does}</dd>
                </div>
              ))}
              <p>Keys work once the view has been clicked.</p>
            </dl>
          )}
          <button type="button" className="world3d__help-toggle" aria-expanded={help} aria-label="Camera controls" onClick={() => setHelp((open) => !open)}>
            ?
          </button>
        </div>
      )}
      {(unavailable ?? problem ?? progress) && (
        <p role="status" className="world3d__note">
          {!unavailable && !problem && <OrbMark size={18} spinning />}
          {unavailable ?? problem ?? progress}
        </p>
      )}
    </div>
  );
}

/** Asks before a route other spawns walk is changed for all of them. */
function SharedRouteDialog({ shared, onAnswer }: { shared: SharedRoute; onAnswer(yes: boolean): void }): React.JSX.Element {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onAnswer(false)}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Shared route" onKeyDown={(e) => e.key === 'Escape' && onAnswer(false)}>
        <header className="modal__header">
          <h2>Shared route</h2>
        </header>
        <p>
          This route is walked by {shared.walkers} spawns (path {shared.pathId}). Changing it changes it for all of them.
        </p>
        <div className="world3d__dialog-actions">
          <button type="button" className="btn" onClick={() => onAnswer(false)}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" autoFocus onClick={() => onAnswer(true)}>
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

/** The NPC or object picked in the view: what it is and where it stands, and what its last edit said. */
function SelectedSpawn({ spawn, note, onClose, onRemove }: { spawn: PickedSpawn; note: string | null; onClose(): void; onRemove?(): void }): React.JSX.Element {
  const kind = spawn.kind === 'creature' ? 'NPC' : 'Object';
  return (
    <section className="world3d__selected" aria-label="Selected spawn">
      <header>
        <h3>{spawn.name || `${kind} ${spawn.entry}`}</h3>
        <button type="button" className="world3d__selected-close" aria-label="Clear selection" onClick={onClose}>
          ×
        </button>
      </header>
      <p>
        {kind} {spawn.entry} · spawn {spawn.guid}
        {spawn.own && ' · this quest’s'}
      </p>
      <p className="world3d__selected-place">
        X {spawn.position.x.toFixed(2)} · Y {spawn.position.y.toFixed(2)} · Z {spawn.position.z.toFixed(2)}
      </p>
      {spawn.event && <p>Only during event {spawn.event.id}{spawn.event.name ? `: ${spawn.event.name}` : ''}</p>}
      {spawn.pathId > 0 && <p>Route {spawn.pathId}</p>}
      {spawn.added && <p>Placed here; it is not in the database until the project patch is applied.</p>}
      {note && <p className="world3d__selected-note">{note}</p>}
      {onRemove && (
        <p className="world3d__selected-actions">
          <button type="button" className="btn" onClick={onRemove}>
            Remove
          </button>
        </p>
      )}
    </section>
  );
}

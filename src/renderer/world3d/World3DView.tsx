import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { assetUrl } from '@core/client/asset-url';
import { worldMapDirectory } from '@core/map/world-maps';
import { createWorld3D, type World3D } from './world3d';
import { useApi } from '../state/names';
import type { PickedSpawn, SpawnStatus, SpawnVisibility } from './scene/spawn/SpawnManager';
import type { ViewSpawns } from '@core/db/view-spawns';
import { chooseZ, floorCandidates } from '@core/map/floors';
import { EMPTY_WORLD, type WorldLayer } from '@core/world/layer';
import type { SpawnEdit, SpawnRef } from './edits';
import { WorldChanges } from './WorldChanges';
import { PlaceDialog, type Chosen } from './PlaceDialog';
import { OrbMark } from '../components/OrbMark';
import type { PlaceRequest } from './placing';
import '../views/ProjectDialog.css';
import './world3d.css';

/** The camera's controls, as the help in the corner lists them. */
const CONTROLS: [string, string][] = [
  ['Right-drag', 'Look around'],
  ['Left-click', 'Select an NPC or object'],
  ['G / R', 'Move or rotate the selected spawn'],
  ['Place…', 'Choose an existing NPC or object, then click the ground'],
  ['Shift-click', 'Add a point to the selected NPC’s route'],
  ['Delete', 'Remove the selected route point'],
  ['Ctrl+Z / Ctrl+Y', 'Undo and redo'],
  ['Esc', 'Stop placing, or clear the selection'],
  ['Left-drag', 'Orbit round the point under the cursor'],
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
/** Event spawns (holidays, fairs) are off until asked for: they are only in the world while their event runs. */
const DEFAULT_LAYERS: SpawnVisibility = { creatures: true, objects: true, paths: true, events: false };
const LAYER_LABELS: [keyof SpawnVisibility, string, string?][] = [
  ['creatures', 'NPCs'],
  ['objects', 'Objects'],
  ['paths', 'Paths'],
  ['events', 'Event spawns', 'NPCs and objects that appear only while a game event (a holiday, a fair) runs'],
];

function readLayers(): SpawnVisibility {
  try {
    const saved = JSON.parse(localStorage.getItem(LAYERS_KEY) ?? 'null') as Partial<SpawnVisibility> | null;
    return { ...DEFAULT_LAYERS, ...(saved ?? {}) };
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
  /** The open quest's own NPCs and objects, drawn with the world's. */
  own?: ViewSpawns;
  /** Told which NPC or object was clicked in the view, or null when the selection was cleared. */
  onSelect?(spawn: PickedSpawn | null): void;
  /** Takes edits to the open quest's own spawns; without it, every edit goes to the world layer. */
  onOwnEdit?(edit: SpawnEdit): void;
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

function WorldStage({ map, start, hasClient, own, onSelect, onOwnEdit, focus, active = true, showArea = true, onArea, onPlaceChange }: ViewProps): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null);
  const world = useRef<World3D | null>(null);
  const startRef = useRef(start);
  startRef.current = start;
  const [area, setArea] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [missing, setMissing] = useState<readonly string[]>([]);
  const [status, setStatus] = useState<'loading' | 'slow' | 'ready'>('loading');
  const [help, setHelp] = useState(false);
  const [layers, setLayers] = useState<SpawnVisibility>(readLayers);
  const [spawns, setSpawns] = useState<SpawnStatus | null>(null);
  const [selected, setSelected] = useState<PickedSpawn | null>(null);
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
  const changes = layer.spawns.length + layer.routes.length + layer.added.length;
  // Choosing an existing NPC or object to place, and the one being placed (each click on the ground puts one down)
  const [choosing, setChoosing] = useState(false);
  const [placing, setPlacing] = useState<Chosen | null>(null);
  /** A layer from the World changes list (after a revert): kept and drawn */
  const takeLayer = (next: WorldLayer): void => {
    layerRef.current = next;
    setLayer(next);
    world.current?.setWorldLayer(next);
  };
  /** Takes the camera close to the pending focus and selects it, with the layers that would hide it on */
  const bringIntoView = (): void => {
    const target = pendingFocus.current;
    const current = world.current;
    if (!target || !current) return;
    pendingFocus.current = null;
    setLayers((l) => ({ ...l, [target.kind === 'creature' ? 'creatures' : 'objects']: true, events: l.events || target.event !== null }));
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

  useEffect(() => {
    const element = container.current;
    if (!element || !directory || !hasClient) return;
    setProblem(null);
    setArea(null);
    onAreaRef.current?.(null);
    setMissing([]);
    setStatus('loading');
    setSelected(null);
    setNote(null);
    setPlacing(null);
    let live = true;
    let created: World3D | null = null;
    // Each route's answer to "change it for everyone who walks it?", for as long as this world lives
    const answers = new Map<number, Promise<boolean>>();
    const applyLayer = (next: WorldLayer): void => {
      layerRef.current = next;
      setLayer(next);
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
    const edit = async (change: SpawnEdit): Promise<void> => {
      if (change.spawn.own && onOwnEditRef.current) {
        onOwnEditRef.current(change);
        placed(change);
        return;
      }
      const current = apiRef.current;
      if (!current) return;
      const result =
        change.kind === 'place'
          ? await current.worldMoveSpawn(change.spawn.kind === 'object' ? 'gameobject' : 'creature', change.spawn.guid, change.to)
          : await current.worldSetRoute(
              change.pathId,
              change.points.map((p) => ({ x: p.x, y: p.y, z: p.z, rest: (p.carry as Record<string, string | null> | undefined) ?? {} })),
            );
      if (!live) return;
      if (result.ok) {
        applyLayer(result.value);
        placed(change);
        setNote(null);
      } else {
        setNote(result.error.message);
        created?.setWorldLayer(layerRef.current);
      }
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
    const floorZ = async (x: number, y: number, nearZ: number): Promise<number | null> => {
      const answer = await apiRef.current?.mapFloors(map, x, y);
      if (!answer?.ok || 'reason' in answer.value) return null;
      return chooseZ(floorCandidates(answer.value), nearZ);
    };
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
            onEdit: (change) => void edit(change),
            floorZ,
            beforeRouteEdit,
            onNotice: (message) => live && setNote(message),
            onPlace: (request) => void place(request),
            onPlaceEnd: () => live && setPlacing(null),
            spawns: async (spawnMap, box) => {
              const current = apiRef.current;
              if (!current) return { error: 'the app is not connected' };
              const result = await current.viewSpawns(spawnMap, box);
              return result.ok ? result.value : { error: result.error.message };
            },
          });
          created.setSpawnVisibility(layersRef.current);
          if (!activeRef.current) created.setActive(false);
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
      live = false;
      clearTimeout(slow);
      created?.dispose();
      world.current = null;
    };
  }, [directory, map, hasClient]);

  // The open quest's own spawns, redrawn as they change.
  useEffect(() => {
    if (ownRef.current) world.current?.setOwnSpawns(ownRef.current);
  }, [ownKey]);

  // The layer checkboxes: applied to the world and remembered.
  useEffect(() => {
    world.current?.setSpawnVisibility(layers);
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
          <div className="world3d__layers-actions">
            <button type="button" className="btn" disabled={!api} title="Choose an existing NPC or object, then click the ground to place it" onClick={() => setChoosing(true)}>
              Place…
            </button>
            <button type="button" className="btn" disabled={changes === 0} onClick={() => setChangesOpen(true)}>
              World changes ({changes})
            </button>
          </div>
        </fieldset>
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
      {!unavailable && selected && <SelectedSpawn spawn={selected} note={note} onClose={clearSelection} onRemove={selected.added ? () => void removePlaced(selected) : undefined} />}
      {!unavailable && !selected && note && (
        <p role="status" className="world3d__edit-note">
          {note}
        </p>
      )}
      {changesOpen && api && <WorldChanges api={api} onLayer={takeLayer} onClose={() => setChangesOpen(false)} />}
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
      {spawn.added && <p>Placed here; it is not in the database until the world patch is applied.</p>}
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

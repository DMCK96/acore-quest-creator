import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { assetUrl } from '@core/client/asset-url';
import { worldMapDirectory } from '@core/map/world-maps';
import { createWorld3D, type World3D } from './world3d';
import { useApi } from '../state/names';
import type { PickedSpawn, SpawnStatus, SpawnVisibility } from './scene/spawn/SpawnManager';
import type { ViewSpawns } from '@core/db/view-spawns';
import './world3d.css';

/** The camera's controls, as the help in the corner lists them. */
const CONTROLS: [string, string][] = [
  ['Right-drag', 'Look around'],
  ['Left-click', 'Select an NPC or object'],
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
}

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

function WorldStage({ map, start, hasClient, own, onSelect }: ViewProps): React.JSX.Element {
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
    setMissing([]);
    setStatus('loading');
    setSelected(null);
    let live = true;
    let created: World3D | null = null;
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
            onArea: setArea,
            onReady: () => live && setStatus('ready'),
            onProblems: (all) => live && setMissing(all),
            onError: setProblem,
            onSelect: (spawn) => {
              if (!live) return;
              setSelected(spawn);
              onSelectRef.current?.(spawn);
            },
            spawns: async (spawnMap, box) => {
              const current = apiRef.current;
              if (!current) return { error: 'the app is not connected' };
              const result = await current.viewSpawns(spawnMap, box);
              return result.ok ? result.value : { error: result.error.message };
            },
          });
          created.setSpawnVisibility(layersRef.current);
          if (ownRef.current) created.setOwnSpawns(ownRef.current);
          world.current = created;
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

  function clearSelection(): void {
    world.current?.select(null);
    setSelected(null);
    onSelectRef.current?.(null);
  }

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
      {area && <p className="world3d__area">{area}</p>}
      {missing.length > 0 && (
        <p className="world3d__missing" title={missing.join('\n')}>
          {missing.length === 1 ? '1 thing' : `${missing.length} things`} could not be loaded and {missing.length === 1 ? 'is' : 'are'} left out:{' '}
          {missing.slice(0, 2).join('; ')}
          {missing.length > 2 ? '; …' : ''} (all of them are in the console)
        </p>
      )}
      {!unavailable && (
        <fieldset className="world3d__layers" aria-label="Layers">
          {LAYER_LABELS.map(([key, label, title]) => (
            <label key={key} title={title}>
              <input type="checkbox" checked={layers[key]} onChange={(e) => setLayers((l) => ({ ...l, [key]: e.target.checked }))} />
              {label}
            </label>
          ))}
        </fieldset>
      )}
      {!unavailable && selected && <SelectedSpawn spawn={selected} onClose={clearSelection} />}
      {!unavailable && spawnNote(spawns) && <p className="world3d__spawn-note">{spawnNote(spawns)}</p>}
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
          {unavailable ?? problem ?? progress}
        </p>
      )}
    </div>
  );
}

/** The NPC or object picked in the view: what it is and where it stands. */
function SelectedSpawn({ spawn, onClose }: { spawn: PickedSpawn; onClose(): void }): React.JSX.Element {
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
    </section>
  );
}

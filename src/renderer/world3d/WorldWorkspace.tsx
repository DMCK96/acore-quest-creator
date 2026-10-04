import { useEffect, useRef, useState } from 'react';
import { WORLD_MAPS, worldMapById } from '@core/map/world-maps';
import type { TeleportSpot } from '@core/map/teleports';
import { World3DView, type FocusTarget } from './World3DView';
import { FindDialog, type FoundSpawn } from './FindDialog';
import { TeleportDialog } from './TeleportDialog';
import { QuestOrb } from '../components/QuestOrb';
import { readLastPlace, writeLastPlace } from './last-place';
import { markWelcomeSeen, welcomeSeen } from './welcome-seen';
import { Welcome } from './Welcome';
import './world3d.css';

export interface WorldWorkspaceProps {
  /** Whether a game client folder is set: the world is drawn from it */
  hasClient: boolean;
  /** False while the Quests workspace is showing: the world rests until it is shown again. True by default. */
  active?: boolean;
  /** The open project's key (see `projectKey`), for its first-time welcome */
  projectKey: string;
  projectName: string;
  onOpenSettings(): void;
  onShowQuests(): void;
  onStartQuest(): void;
}

type Point = { x: number; y: number; z: number };

/**
 * The world, as the app's main workspace: the 3D view of a continent with a place card (where the
 * camera is, Teleport, Find and typed coordinates). It opens where it was left. Without a game client
 * it says what is needed instead. The first time a project is shown here, a welcome over the orb offers
 * a place to start.
 */
export function WorldWorkspace({ hasClient, active = true, projectKey, projectName, onOpenSettings, onShowQuests, onStartQuest }: WorldWorkspaceProps): React.JSX.Element {
  const [first] = useState(readLastPlace);
  const [mapId, setMapId] = useState(first.map);
  const [at, setAt] = useState<Point>({ x: first.x, y: first.y, z: first.z });
  const mapRef = useRef(mapId);
  mapRef.current = mapId;
  // The coordinates being typed; they only move the camera on Go.
  const [typed, setTyped] = useState({ x: String(first.x), y: String(first.y), z: String(first.z) });
  const [area, setArea] = useState<string | null>(null);
  const [coordinates, setCoordinates] = useState(false);
  const [teleporting, setTeleporting] = useState(false);
  const [finding, setFinding] = useState(false);
  // The spawn the view is to bring into view (each pick is its own, even of the same spawn)
  const [focus, setFocus] = useState<FocusTarget | undefined>();
  // Projects whose welcome was closed here; read with what storage says, so a project greeted
  // elsewhere, or opened while this was hidden, is handled when the world is next shown
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const welcoming = active && hasClient && !closed.has(projectKey) && !welcomeSeen(projectKey);
  /** Closes the welcome for this project for good, then does what was chosen */
  const leaveWelcome = (then?: () => void): void => {
    markWelcomeSeen(projectKey);
    setClosed((keys) => new Set(keys).add(projectKey));
    then?.();
  };

  /** Moves the camera to a point, on the map given (this one by default), and remembers it */
  const goTo = (point: Point, map = mapRef.current): void => {
    if (map !== mapRef.current) setMapId(map);
    setAt(point);
    setTyped({ x: String(point.x), y: String(point.y), z: String(point.z) });
    writeLastPlace({ map, ...point });
  };
  const chooseMap = (id: number): void => goTo(worldMapById(id)!.start, id);
  const teleport = (spot: TeleportSpot): void => {
    setTeleporting(false);
    goTo({ x: spot.x, y: spot.y, z: spot.z }, spot.map);
  };
  const find = (spawn: FoundSpawn): void => {
    setFinding(false);
    goTo({ x: spawn.x, y: spawn.y, z: spawn.z }, spawn.map);
    setFocus((previous) => ({
      kind: spawn.kind, guid: spawn.guid, entry: spawn.entry, name: spawn.name, x: spawn.x, y: spawn.y, z: spawn.z,
      event: spawn.event, added: spawn.note === 'placed', nonce: (previous?.nonce ?? 0) + 1,
    }));
  };
  const parsed = { x: Number(typed.x), y: Number(typed.y), z: Number(typed.z) };
  const valid = [typed.x, typed.y, typed.z].every((v) => v.trim() !== '') && Object.values(parsed).every(Number.isFinite);

  // Esc closes this workspace's own panels, the top one first; it never leaves the world. The view
  // clears its own selection.
  const panels = useRef({ finding, teleporting, coordinates, welcoming, leaveWelcome });
  panels.current = { finding, teleporting, coordinates, welcoming, leaveWelcome };
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      const open = panels.current;
      if (open.finding) setFinding(false);
      else if (open.teleporting) setTeleporting(false);
      else if (open.coordinates) setCoordinates(false);
      else if (open.welcoming) open.leaveWelcome();
      else return;
      e.stopPropagation();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [active]);

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
    <section className="world-workspace" aria-label="World">
      <World3DView
        map={mapId}
        start={at}
        hasClient
        focus={focus}
        active={active}
        showArea={false}
        onArea={setArea}
        onPlaceChange={(place) => writeLastPlace({ map: mapRef.current, ...place })}
      />
      <section className="world-place glass" aria-label="Place">
        <h2 className="world-place__title">{area ?? mapName}</h2>
        {area && <p className="world-place__map section-label">{mapName}</p>}
        <div className="world-place__actions">
          <button type="button" className="btn" onClick={() => setTeleporting(true)}>
            Teleport
          </button>
          <button type="button" className="btn" onClick={() => setFinding(true)}>
            Find…
          </button>
          <button type="button" className="btn" aria-expanded={coordinates} onClick={() => setCoordinates((open) => !open)}>
            Coordinates
          </button>
        </div>
        {coordinates && (
          <form
            className="world-place__coordinates"
            onSubmit={(e) => {
              e.preventDefault();
              if (!valid) return;
              goTo(parsed);
              setCoordinates(false);
            }}
          >
            <label className="scene-field world-place__map-field">
              <span>Map</span>
              <select value={mapId} onChange={(e) => chooseMap(Number(e.target.value))}>
                {WORLD_MAPS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
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
      {welcoming && (
        <Welcome
          projectName={projectName}
          onPick={(spot) => leaveWelcome(() => teleport(spot))}
          onFind={() => leaveWelcome(() => setFinding(true))}
          onStartQuest={() => leaveWelcome(onStartQuest)}
          onClose={() => leaveWelcome()}
        />
      )}
      {finding && <FindDialog from={{ map: mapId, ...at }} onGo={find} onClose={() => setFinding(false)} />}
      {teleporting && <TeleportDialog onPick={teleport} onClose={() => setTeleporting(false)} />}
    </section>
  );
}

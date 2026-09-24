import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { readEntities } from '@core/entities/model';
import { addZ, chooseZ, floorCandidates } from '@core/map/floors';
import { addSpawn, moveMarker, questMarkers, questRoutes } from '@core/map/positions';
import type { Spawn } from '@core/entities/model';
import type { FieldValue } from '@core/registry/types';
import type { MapBox, MapInfo, OpenResult, QuestMapRef, SpawnDot } from '@shared/ipc';
import { EntityPicker } from '../controls/EntityPicker';
import { useApi } from '../state/names';
import type { MapMode } from './MapOpener';
import { PatrolPanel } from './PatrolPanel';
import { usePatrolMode } from './usePatrolMode';
import { LeafletMap, type MapMarkerView, type MapView } from './LeafletMap';
import './map.css';

/**
 * The quest's map: every position the quest uses, on the relief of the map it is on. The quest's
 * own positions can be dragged, a click offers to add a spawn there, and every drop takes its Z
 * from the server's floors at that point. All edits go through `onChange`, like a module's.
 */

const CONTINENTS: MapInfo[] = [
  { id: 0, name: 'Eastern Kingdoms', zones: [] },
  { id: 1, name: 'Kalimdor', zones: [] },
  { id: 530, name: 'Outland', zones: [] },
  { id: 571, name: 'Northrend', zones: [] },
];
/** Opens close enough in that existing spawns show. */
const START_ZOOM = 7;
/** Below this zoom no spawn dots are loaded: a whole zone of dots is slow and unreadable. */
const DOT_ZOOM = 7;
const VIEW_DELAY_MS = 300;
/** "Only quest-relevant" is remembered while the app runs, across openings of the map. */
let questOnlyForSession = false;
const ROLE_WORDS = { giver: 'quest giver', ender: 'quest ender', objective: 'objective' } as const;

interface Floors {
  id: string;
  x: number;
  y: number;
  candidates: number[];
}

type FloorResult = { floors: number[]; ground: number | null };

type Target = { kind: 'npc' | 'object'; entry: number };
/** What map clicks do: the modes a caller opens the map in, plus the moment after a placement. */
type Mode = MapMode | { kind: 'placed'; target: Target; guid: number } | null;

export function QuestMapView({
  open,
  onChange,
  focusId,
  onClose,
  hasServerData = true,
  hasClient = true,
  mode = null,
}: {
  open: OpenResult;
  onChange(fieldId: string, value: FieldValue): void;
  focusId: string | null;
  onClose(): void;
  /** Whether the connection names a server data folder; without one there is no terrain or floors. */
  hasServerData?: boolean;
  /** Whether the connection names a game client folder; without one the map shows the relief, not the client's art. */
  hasClient?: boolean;
  /** What the map is opened to do; by default it just shows the quest. */
  mode?: MapMode | null;
}): React.JSX.Element {
  const api = useApi();
  const values = open.aggregate.values;
  // Edits are built after awaiting the server, from the values as they are then: a second drag made
  // while the first waited must not be undone by it.
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const [maps, setMaps] = useState<MapInfo[]>(CONTINENTS);
  const [refs, setRefs] = useState<QuestMapRef[]>([]);
  const [dots, setDots] = useState<SpawnDot[]>([]);
  const [capped, setCapped] = useState(false);
  const [zoomedOut, setZoomedOut] = useState(false);
  const [questOnly, setQuestOnly] = useState(questOnlyForSession);
  const lastView = useRef<{ box: MapBox; zoom: number } | null>(null);
  /** Only the reply to the latest view is used: a slow one must not bring dots back after zooming out. */
  const spawnRequest = useRef(0);
  const [selectedId, setSelectedId] = useState<string | null>(focusId);
  const [floors, setFloors] = useState<Floors | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [clickAt, setClickAt] = useState<{ x: number; y: number } | null>(null);
  const [adding, setAdding] = useState(false);
  const [modeState, setMode] = useState<Mode>(mode);
  const [searchKind, setSearchKind] = useState<'creature' | 'gameobject'>('creature');
  const [searchEntry, setSearchEntry] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  /** The map the author chose, and where the map was last asked to look; until then, the quest's positions. */
  const [mapId, setMapId] = useState<number | null>(null);
  const [view, setView] = useState<MapView | null>(null);
  const viewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!api) return;
    let live = true;
    void api.mapList().then((r) => live && r.ok && r.value.length > 0 && setMaps(r.value));
    void api.questMapRefs(open.questId).then((r) => live && r.ok && setRefs(r.value));
    return () => {
      live = false;
      if (viewTimer.current) clearTimeout(viewTimer.current);
    };
  }, [api, open.questId]);

  const allMarkers = useMemo<MapMarkerView[]>(() => {
    const knownMaps = new Map<string, number>();
    for (const ref of refs) if (!knownMaps.has(`${ref.kind}:${ref.entry}`)) knownMaps.set(`${ref.kind}:${ref.entry}`, ref.map);
    const own: MapMarkerView[] = questMarkers(values, knownMaps);
    const referenced: MapMarkerView[] = refs.map((ref) => ({
      id: `ref:${ref.kind}:${ref.guid}`, kind: ref.kind === 'creature' ? 'npcSpawn' : 'objectSpawn',
      label: `${ref.name || `#${ref.entry}`} (${ROLE_WORDS[ref.role]})`, map: ref.map, x: ref.x, y: ref.y, z: ref.z,
      draggable: false, readOnlyRole: ref.role,
    }));
    return [...own, ...referenced];
  }, [values, refs]);

  const shownIds = new Set(maps.map((m) => m.id));
  const focus = allMarkers.find((m) => m.id === focusId);
  const firstShown = allMarkers.find((m) => m.map !== null && shownIds.has(m.map));
  const currentMap = mapId ?? (focus && focus.map !== null && shownIds.has(focus.map) ? focus.map : (firstShown?.map ?? 0));

  /** Looks at a point; a new `seq` each time, so picking the same position twice still flies there. */
  const flyTo = (x: number, y: number): void => setView((v) => ({ x, y, seq: (v?.seq ?? 0) + 1 }));

  const patrolKey = modeState?.kind === 'patrol' ? `${modeState.entry}:${modeState.guid}` : null;
  const patrolTarget = useMemo(() => {
    if (patrolKey === null) return null;
    const [entry, guid] = patrolKey.split(':').map(Number) as [number, number];
    return { entry, guid };
  }, [patrolKey]);
  const leavePatrol = useCallback((why: string | null) => {
    setMessage(why);
    setMode(null);
  }, []);
  const enterPatrol = useCallback((spawn: Spawn) => {
    setMapId(spawn.map);
    setView((v) => ({ x: spawn.x, y: spawn.y, seq: (v?.seq ?? 0) + 1 }));
  }, []);
  const patrol = usePatrolMode({
    api, target: patrolTarget, values, valuesRef, onChange, floorsAt, currentMap,
    mapName: (id) => maps.find((m) => m.id === id)?.name ?? `map ${id}`,
    onLeave: leavePatrol, onEnter: enterPatrol,
  });
  const activeRoute = patrol.active?.routeId ?? null;
  // Patrol points show only while their own route is drawn; otherwise the route line is enough.
  const markers = allMarkers.filter((m) => m.kind !== 'patrolPoint' || (activeRoute !== null && m.id.startsWith(`${activeRoute}:`)));
  const routes = questRoutes(values)
    .filter((r) => r.map === currentMap)
    .map((r) => ({ id: r.id, points: r.points, facings: r.facings, active: r.id === activeRoute }));
  const onThisMap = markers.filter((m) => m.map === currentMap || m.map === null);
  const otherMaps = maps
    .filter((m) => m.id !== currentMap)
    .map((m) => ({ map: m, markers: markers.filter((k) => k.map === m.id) }))
    .filter((g) => g.markers.length > 0);
  const offView = markers.filter((m) => m.map !== null && !shownIds.has(m.map));
  const start = focus && onThisMap.includes(focus) ? focus : onThisMap[0];
  const shownView: MapView = view ?? (start ? { x: start.x, y: start.y, seq: 0 } : { x: 0, y: 0, seq: 0 });
  const mapInfo = maps.find((m) => m.id === currentMap);

  // The view starts on the quest's first position and then stays put: following the positions would
  // recentre the map on every marker the author drags.
  const startX = start?.x;
  const startY = start?.y;
  useEffect(() => {
    if (view === null && startX !== undefined && startY !== undefined) setView({ x: startX, y: startY, seq: 0 });
  }, [view, startX, startY]);

  /** The floors at a point, or why there are none. */
  async function floorsAt(map: number, x: number, y: number): Promise<{ result: FloorResult | null; reason: string | null }> {
    if (!api) return { result: null, reason: null };
    const answer = await api.mapFloors(map, x, y);
    if (!answer.ok) return { result: null, reason: answer.error.message };
    if ('reason' in answer.value) return { result: null, reason: answer.value.reason };
    return { result: answer.value, reason: null };
  }

  function noteZ(id: string, candidates: number[], reason: string | null): void {
    setNotes((n) => {
      const next = { ...n };
      if (candidates.length === 0) next[id] = `Z not checked: ${reason ?? 'no floor data here'}.`;
      else delete next[id];
      return next;
    });
  }

  async function moved(id: string, at: { x: number; y: number }): Promise<void> {
    const marker = markers.find((m) => m.id === id);
    if (!marker || !marker.draggable) return;
    const { result, reason } = await floorsAt(currentMap, at.x, at.y);
    const candidates = result ? floorCandidates(result) : [];
    const z = chooseZ(candidates, marker.z) ?? marker.z;
    const edit = moveMarker(valuesRef.current, id, { x: at.x, y: at.y, z });
    if (!edit) return;
    onChange(edit.field, edit.value);
    setSelectedId(id);
    setClickAt(null);
    setFloors({ id, x: at.x, y: at.y, candidates });
    noteZ(id, candidates, reason);
  }

  function pickFloor(z: number): void {
    if (!floors) return;
    const edit = moveMarker(valuesRef.current, floors.id, { x: floors.x, y: floors.y, z });
    if (edit) onChange(edit.field, edit.value);
  }

  /** Adds a spawn at a point; the new spawn's guid, or null when none was added. */
  async function addHere(kind: 'npc' | 'object', entry: number, spot: { x: number; y: number }): Promise<number | null> {
    if (!api || adding) return null;
    const map = currentMap;
    setAdding(true);
    try {
      const allocated = await api.allocateIds(kind === 'npc' ? 'creatureSpawn' : 'gameobjectSpawn', 1);
      if (!allocated.ok || allocated.value.length === 0) {
        setMessage(allocated.ok ? 'No free spawn ID could be found.' : allocated.error.message);
        return null;
      }
      const guid = allocated.value[0]!;
      const { result, reason } = await floorsAt(map, spot.x, spot.y);
      const candidates = result ? floorCandidates(result) : [];
      const z = (result ? addZ(result) : null) ?? 0;
      const edit = addSpawn(valuesRef.current, { kind, entry }, { guid, map, x: spot.x, y: spot.y, z, o: 0 });
      if (!edit) return null;
      onChange(edit.field, edit.value);
      const id = `spawn:${kind === 'npc' ? 'npc' : 'obj'}:${entry}:${guid}`;
      setSelectedId(id);
      setFloors({ id, x: spot.x, y: spot.y, candidates });
      noteZ(id, candidates, reason);
      setClickAt(null);
      return guid;
    } finally {
      setAdding(false);
    }
  }

  function viewChanged(box: MapBox, zoom: number, onlyQuest = questOnly): void {
    lastView.current = { box, zoom };
    const request = ++spawnRequest.current;
    if (viewTimer.current) clearTimeout(viewTimer.current);
    setZoomedOut(zoom < DOT_ZOOM);
    if (onlyQuest || zoom < DOT_ZOOM) {
      setDots([]);
      setCapped(false);
      return;
    }
    viewTimer.current = setTimeout(() => {
      void api?.mapSpawns(currentMap, box).then((r) => {
        if (!r.ok || request !== spawnRequest.current) return;
        setDots(r.value.dots);
        setCapped(r.value.capped);
      });
    }, VIEW_DELAY_MS);
  }

  function showMarker(m: MapMarkerView): void {
    if (m.map !== null && m.map !== currentMap) setMapId(m.map);
    setSelectedId(m.id);
    flyTo(m.x, m.y);
  }

  async function jumpTo(entry: number): Promise<void> {
    setSearchEntry(entry);
    if (!api || entry <= 0) return;
    const result = await api.entitySpawns(searchKind, entry);
    const spot = result.ok ? result.value.find((d) => shownIds.has(d.map)) : undefined;
    if (!spot) {
      setMessage('It has no spawn on a map this view shows.');
      return;
    }
    setMessage(null);
    setMapId(spot.map);
    flyTo(spot.x, spot.y);
  }

  const { npcs, objects } = readEntities(values);
  const targetName = (t: Target): string => {
    const found = t.kind === 'npc' ? npcs.find((n) => n.entry === t.entry) : objects.find((o) => o.entry === t.entry);
    return found?.name.trim() || `${t.kind === 'npc' ? 'New NPC' : 'New object'} ${t.entry}`;
  };

  async function mapClicked(at: { x: number; y: number }): Promise<void> {
    if (modeState?.kind === 'patrol') {
      const { handled, message: why } = await patrol.mapClick(at);
      if (handled) {
        setMessage(why);
        return;
      }
    }
    if (modeState?.kind === 'place') {
      const { target } = modeState;
      const guid = await addHere(target.kind, target.entry, at);
      if (guid !== null) setMode({ kind: 'placed', target, guid });
      return;
    }
    setClickAt(at);
    setSelectedId(null);
    setFloors(null);
  }
  const selected = markers.find((m) => m.id === selectedId);
  const item = (m: MapMarkerView): React.JSX.Element => (
    <li key={m.id}>
      <button type="button" className={`quest-map__item${m.id === selectedId ? ' quest-map__item--selected' : ''}`} onClick={() => showMarker(m)}>
        {m.label}
      </button>
    </li>
  );

  return (
    <div role="dialog" aria-label="Quest map" className="quest-map">
      <header className="quest-map__header">
        <h2 className="quest-map__title">Quest map</h2>
        <label className="scene-field">
          <span>Map</span>
          <select
            value={currentMap}
            onChange={(e) => {
              setMapId(Number(e.target.value));
              setView(null);
            }}
          >
            {maps.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="scene-field">
          <span>Find</span>
          <select value={searchKind} onChange={(e) => setSearchKind(e.target.value as 'creature' | 'gameobject')}>
            <option value="creature">NPC</option>
            <option value="gameobject">Object</option>
          </select>
        </label>
        <div className="quest-map__search">
          <EntityPicker id="quest-map-search" label="Jump to" kind={searchKind} value={searchEntry} onChange={(entry) => void jumpTo(entry)} />
        </div>
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </header>
      <div className="quest-map__body">
        <LeafletMap
          map={currentMap}
          view={shownView}
          zoom={START_ZOOM}
          markers={onThisMap}
          dots={dots}
          zones={mapInfo?.zones ?? []}
          selectedId={selectedId}
          onMarkerMoved={(id, at) => void moved(id, at)}
          onMapClick={(at) => void mapClicked(at)}
          routes={routes}
          onRouteClick={(routeId, at) => void patrol.routeClick(routeId, at)}
          onMarkerSelected={(id) => {
            setSelectedId(id);
            if (activeRoute !== null && id.startsWith(`${activeRoute}:`)) patrol.setSelected(Number(id.split(':')[3]));
          }}
          onViewChanged={(box, zoom) => viewChanged(box, zoom)}
        />
        <aside className="quest-map__side">
          {modeState?.kind === 'place' && (
            <div role="status" className="quest-map__mode">
              <p>Click where {targetName(modeState.target)} should stand.</p>
              <button type="button" className="entry-card__btn" onClick={() => setMode(null)}>
                Cancel
              </button>
            </div>
          )}
          {modeState?.kind === 'placed' && (
            <div role="status" className="quest-map__mode">
              <p>Placed. Drag to adjust, or draw its patrol.</p>
              {modeState.target.kind === 'npc' && (
                <button type="button" className="entry-card__btn"
                  onClick={() => setMode({ kind: 'patrol', entry: modeState.target.entry, guid: modeState.guid })}>
                  Draw patrol
                </button>
              )}
              <button type="button" className="entry-card__btn" onClick={() => setMode(null)}>
                Done
              </button>
            </div>
          )}
          {!hasServerData && <p className="scene-warning">Set the server data folder on the connection to see the terrain and floors.</p>}
          {message && <p className="scene-warning">{message}</p>}
          {!hasClient && <p className="scene-hint">Set the game client folder on the connection to see the in-game map art.</p>}
          {capped && <p className="scene-hint">Zoom in to see every spawn here.</p>}
          {zoomedOut && !questOnly && <p className="scene-hint">Zoom in to see existing spawns.</p>}
          <label className="scene-field">
            <input
              type="checkbox"
              checked={questOnly}
              onChange={(e) => {
                const on = e.target.checked;
                questOnlyForSession = on;
                setQuestOnly(on);
                if (lastView.current) viewChanged(lastView.current.box, lastView.current.zoom, on);
              }}
            />{' '}
            Only quest-relevant
          </label>
          {patrol.active?.patrol && (
            <PatrolPanel
              name={patrol.active.npc.name.trim() || `New NPC ${patrol.active.entry}`}
              patrol={patrol.active.patrol}
              selected={patrol.selected}
              picking={patrol.picking}
              onSelect={patrol.setSelected}
              onChange={patrol.save}
              onPickFacing={(i) => {
                patrol.setSelected(i);
                patrol.setPicking('facing');
              }}
              onDone={() => setMode(null)}
            />
          )}
          {selected && !patrol.active && (
            <section className="quest-map__selected" aria-label="Selected position">
              <h3>{selected.label}</h3>
              <p className="scene-hint">
                X {selected.x.toFixed(2)} · Y {selected.y.toFixed(2)} · Z {selected.z.toFixed(2)}
              </p>
              {selected.note && <p className="scene-hint">{selected.note}</p>}
              {notes[selected.id] && <p className="scene-warning">{notes[selected.id]}</p>}
              {floors?.id === selected.id && floors.candidates.length > 0 && (
                <div className="quest-map__floors">
                  {floors.candidates.map((z) => (
                    <button key={z} type="button" className="entry-card__btn" onClick={() => pickFloor(z)}>
                      Floor {z}
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}
          {clickAt && (
            <section aria-label="Add a spawn">
              <p className="scene-hint">
                X {clickAt.x.toFixed(2)} · Y {clickAt.y.toFixed(2)}
              </p>
              {npcs.length + objects.length === 0 && <p className="scene-hint">Add an NPC or object in NPCs &amp; objects to place it here.</p>}
              {npcs.map((n) => (
                <button key={`n${n.entry}`} type="button" className="entry-card__btn" disabled={adding} onClick={() => void addHere('npc', n.entry, clickAt)}>
                  Add a spawn here for {n.name.trim() || `New NPC ${n.entry}`}
                </button>
              ))}
              {objects.map((o) => (
                <button key={`o${o.entry}`} type="button" className="entry-card__btn" disabled={adding} onClick={() => void addHere('object', o.entry, clickAt)}>
                  Add a spawn here for {o.name.trim() || `New object ${o.entry}`}
                </button>
              ))}
            </section>
          )}
          <h3 className="scene-section__title">Positions</h3>
          <ul aria-label="Quest positions" className="quest-map__list">
            {onThisMap.map(item)}
          </ul>
          {otherMaps.map((group) => (
            <div key={group.map.id}>
              <h3 className="scene-section__title">On {group.map.name}</h3>
              <ul aria-label={`Positions on ${group.map.name}`} className="quest-map__list">
                {group.markers.map(item)}
              </ul>
            </div>
          ))}
          {offView.map((m) => (
            <p key={m.id} className="scene-hint">
              {m.label} is on a map this view does not show yet.
            </p>
          ))}
        </aside>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { readEntities } from '@core/entities/model';
import { chooseZ, floorCandidates } from '@core/map/floors';
import { addSpawn, moveMarker, questMarkers } from '@core/map/positions';
import type { FieldValue } from '@core/registry/types';
import type { MapBox, MapInfo, OpenResult, QuestMapRef, SpawnDot } from '@shared/ipc';
import { EntityPicker } from '../controls/EntityPicker';
import { useApi } from '../state/names';
import { LeafletMap, type MapMarkerView } from './LeafletMap';
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
const START_ZOOM = 6;
const VIEW_DELAY_MS = 300;
const ROLE_WORDS = { giver: 'quest giver', ender: 'quest ender', objective: 'objective' } as const;

interface Floors {
  id: string;
  x: number;
  y: number;
  candidates: number[];
}

export function QuestMapView({
  open,
  onChange,
  focusId,
  onClose,
}: {
  open: OpenResult;
  onChange(fieldId: string, value: FieldValue): void;
  focusId: string | null;
  onClose(): void;
}): React.JSX.Element {
  const api = useApi();
  const values = open.aggregate.values;
  const [maps, setMaps] = useState<MapInfo[]>(CONTINENTS);
  const [refs, setRefs] = useState<QuestMapRef[]>([]);
  const [dots, setDots] = useState<SpawnDot[]>([]);
  const [capped, setCapped] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(focusId);
  const [floors, setFloors] = useState<Floors | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [clickAt, setClickAt] = useState<{ x: number; y: number } | null>(null);
  const [searchKind, setSearchKind] = useState<'creature' | 'gameobject'>('creature');
  const [searchEntry, setSearchEntry] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  /** The map and centre the author chose; until then, where the quest's positions are. */
  const [mapId, setMapId] = useState<number | null>(null);
  const [center, setCenter] = useState<{ x: number; y: number } | null>(null);
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

  const markers = useMemo<MapMarkerView[]>(() => {
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
  const focus = markers.find((m) => m.id === focusId);
  const firstShown = markers.find((m) => m.map !== null && shownIds.has(m.map));
  const currentMap = mapId ?? (focus && focus.map !== null && shownIds.has(focus.map) ? focus.map : (firstShown?.map ?? 0));
  const onThisMap = markers.filter((m) => m.map === currentMap || m.map === null);
  const offView = markers.filter((m) => m.map !== null && !shownIds.has(m.map));
  const start = focus && onThisMap.includes(focus) ? focus : onThisMap[0];
  const shownCenter = center ?? (start ? { x: start.x, y: start.y } : { x: 0, y: 0 });
  // The view starts on the quest's first position and then stays put: following the positions would
  // recentre the map on every marker the author drags.
  const startX = start?.x;
  const startY = start?.y;
  useEffect(() => {
    if (center === null && startX !== undefined && startY !== undefined) setCenter({ x: startX, y: startY });
  }, [center, startX, startY]);
  const mapInfo = maps.find((m) => m.id === currentMap);

  /** The floors at a point: their candidates, or why there are none. */
  async function floorsAt(x: number, y: number): Promise<{ candidates: number[]; reason: string | null }> {
    if (!api) return { candidates: [], reason: null };
    const result = await api.mapFloors(currentMap, x, y);
    if (!result.ok) return { candidates: [], reason: result.error.message };
    if ('reason' in result.value) return { candidates: [], reason: result.value.reason };
    return { candidates: floorCandidates(result.value), reason: null };
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
    const { candidates, reason } = await floorsAt(at.x, at.y);
    const z = chooseZ(candidates, marker.z) ?? marker.z;
    const edit = moveMarker(values, id, { x: at.x, y: at.y, z });
    if (!edit) return;
    onChange(edit.field, edit.value);
    setSelectedId(id);
    setClickAt(null);
    setFloors({ id, x: at.x, y: at.y, candidates });
    noteZ(id, candidates, reason);
  }

  function pickFloor(z: number): void {
    if (!floors) return;
    const edit = moveMarker(values, floors.id, { x: floors.x, y: floors.y, z });
    if (edit) onChange(edit.field, edit.value);
  }

  async function addHere(kind: 'npc' | 'object', entry: number): Promise<void> {
    if (!api || !clickAt) return;
    const allocated = await api.allocateIds(kind === 'npc' ? 'creatureSpawn' : 'gameobjectSpawn', 1);
    if (!allocated.ok || allocated.value.length === 0) {
      setMessage(allocated.ok ? 'No free spawn ID could be found.' : allocated.error.message);
      return;
    }
    const guid = allocated.value[0]!;
    const { candidates, reason } = await floorsAt(clickAt.x, clickAt.y);
    const z = chooseZ(candidates, null) ?? 0;
    const edit = addSpawn(values, { kind, entry }, { guid, map: currentMap, x: clickAt.x, y: clickAt.y, z, o: 0 });
    if (!edit) return;
    onChange(edit.field, edit.value);
    const id = `spawn:${kind === 'npc' ? 'npc' : 'obj'}:${entry}:${guid}`;
    setSelectedId(id);
    setFloors({ id, x: clickAt.x, y: clickAt.y, candidates });
    noteZ(id, candidates, reason);
    setClickAt(null);
  }

  function viewChanged(box: MapBox): void {
    if (viewTimer.current) clearTimeout(viewTimer.current);
    viewTimer.current = setTimeout(() => {
      void api?.mapSpawns(currentMap, box).then((r) => {
        if (!r.ok) return;
        setDots(r.value.dots);
        setCapped(r.value.capped);
      });
    }, VIEW_DELAY_MS);
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
    setCenter({ x: spot.x, y: spot.y });
  }

  const { npcs, objects } = readEntities(values);
  const selected = markers.find((m) => m.id === selectedId);

  return (
    <div role="dialog" aria-label="Quest map" className="quest-map">
      <header className="quest-map__header">
        <h2 className="quest-map__title">Quest map</h2>
        <label className="scene-field">
          <span>Map</span>
          <select value={currentMap} onChange={(e) => { setMapId(Number(e.target.value)); setCenter(null); }}>
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
          center={shownCenter}
          zoom={START_ZOOM}
          markers={onThisMap}
          dots={dots}
          zones={mapInfo?.zones ?? []}
          selectedId={selectedId}
          onMarkerMoved={(id, at) => void moved(id, at)}
          onMapClick={(at) => {
            setClickAt(at);
            setSelectedId(null);
            setFloors(null);
          }}
          onMarkerSelected={(id) => setSelectedId(id)}
          onViewChanged={(box) => viewChanged(box)}
        />
        <aside className="quest-map__side">
          {message && <p className="scene-warning">{message}</p>}
          {capped && <p className="scene-hint">Zoom in to see every spawn here.</p>}
          {selected && (
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
                <button key={`n${n.entry}`} type="button" className="entry-card__btn" onClick={() => void addHere('npc', n.entry)}>
                  Add a spawn here for {n.name.trim() || `New NPC ${n.entry}`}
                </button>
              ))}
              {objects.map((o) => (
                <button key={`o${o.entry}`} type="button" className="entry-card__btn" onClick={() => void addHere('object', o.entry)}>
                  Add a spawn here for {o.name.trim() || `New object ${o.entry}`}
                </button>
              ))}
            </section>
          )}
          <h3 className="scene-section__title">Positions</h3>
          <ul aria-label="Quest positions" className="quest-map__list">
            {onThisMap.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className={`quest-map__item${m.id === selectedId ? ' quest-map__item--selected' : ''}`}
                  onClick={() => {
                    setSelectedId(m.id);
                    setCenter({ x: m.x, y: m.y });
                  }}
                >
                  {m.label}
                </button>
              </li>
            ))}
          </ul>
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

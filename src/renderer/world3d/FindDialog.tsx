import { useEffect, useRef, useState } from 'react';
import type { SpawnDot } from '@core/db/spawns';
import { worldMapById } from '@core/map/world-maps';
import type { WorldLayer } from '@core/world/layer';
import { useApi } from '../state/names';
import { trapTab } from '../components/trap-tab';
import { useEntityHits } from './useEntityHits';
import '../views/ProjectDialog.css';

/** One spawn of the NPC or object being looked for, as the list shows it and the view jumps to it */
export interface FoundSpawn {
  kind: 'creature' | 'object';
  guid: number;
  entry: number;
  name: string;
  map: number;
  x: number;
  y: number;
  z: number;
  /** Appears only while this game event runs */
  event: { id: number; name: string } | null;
  /** In the world layer: put there in the 3D view (`placed`), or moved there from where the database has it */
  note: 'placed' | 'moved' | null;
}

type Kind = FoundSpawn['kind'];

const distance = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/**
 * The spawns of an NPC or object: the database's, as the world layer has moved them, and those placed
 * in the 3D view. On the map being looked at first, nearest first; then the other maps.
 */
export function foundSpawns(dots: readonly SpawnDot[], layer: WorldLayer, entry: number, kind: Kind, from: { map: number; x: number; y: number; z: number }): FoundSpawn[] {
  const layerKind = kind === 'creature' ? 'creature' : 'gameobject';
  const moved = new Map(layer.spawns.filter((s) => s.kind === layerKind).map((s) => [s.guid, s]));
  const fromDatabase = dots.map((d): FoundSpawn => {
    const edit = moved.get(d.guid);
    return {
      kind, guid: d.guid, entry: d.entry, name: d.name, map: d.map,
      x: edit?.current.x ?? d.x, y: edit?.current.y ?? d.y, z: edit?.current.z ?? d.z,
      event: d.event ?? null, note: edit ? 'moved' : null,
    };
  });
  const placed = layer.added
    .filter((a) => a.kind === layerKind && a.entry === entry)
    .map((a): FoundSpawn => ({ kind, guid: a.guid, entry, name: a.name, map: a.map, x: a.placement.x, y: a.placement.y, z: a.placement.z, event: null, note: 'placed' }));
  const here = (s: FoundSpawn): boolean => s.map === from.map;
  return [...fromDatabase, ...placed].sort((a, b) => Number(here(b)) - Number(here(a)) || (here(a) ? distance(a, from) - distance(b, from) : a.map - b.map || a.guid - b.guid));
}

/**
 * Finds an NPC or object by name or id, lists every spawn it has (those the database has, those moved
 * or placed in the 3D view), and jumps the view to one of them.
 */
export function FindDialog({ from, onGo, onClose }: { from: { map: number; x: number; y: number; z: number }; onGo(spawn: FoundSpawn): void; onClose(): void }): React.JSX.Element {
  const dialog = useRef<HTMLDivElement>(null);
  const api = useApi();
  const [kind, setKind] = useState<Kind>('creature');
  const [text, setText] = useState('');
  const { hits, error, searched } = useEntityHits(kind === 'creature' ? 'creature' : 'gameobject', text);
  const [chosen, setChosen] = useState<{ entry: number; name: string } | null>(null);
  const [spawns, setSpawns] = useState<FoundSpawn[] | null>(null);
  const [capped, setCapped] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // The chosen one's spawns, with the layer's edits laid over them
  useEffect(() => {
    if (!chosen || !api) return;
    let live = true;
    setSpawns(null);
    setProblem(null);
    void Promise.all([api.findSpawns(kind === 'creature' ? 'creature' : 'gameobject', chosen.entry), api.worldLayer()]).then(([found, layer]) => {
      if (!live) return;
      if (!found.ok) {
        setProblem(found.error.message);
        return;
      }
      setCapped(found.value.capped);
      setSpawns(foundSpawns(found.value.spawns, layer.ok ? layer.value : { spawns: [], routes: [], added: [] }, chosen.entry, kind, from));
    });
    return () => {
      live = false;
    };
    // The list is made once per choice; moving the camera meanwhile does not reorder it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen, api, kind]);

  const word = kind === 'creature' ? 'NPC' : 'object';

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={dialog} className="modal place-dialog find-dialog" role="dialog" aria-modal="true" aria-label="Find an NPC or object" onKeyDown={(e) => trapTab(e, dialog.current)}>
        <header className="modal__header">
          <h2>Find an NPC or object</h2>
          <button type="button" className="btn btn--icon" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        {!chosen && (
          <>
            <div className="place-dialog__kinds" role="radiogroup" aria-label="What to find">
              {(['creature', 'object'] as const).map((k) => (
                <label key={k}>
                  <input type="radio" name="find-kind" checked={kind === k} onChange={() => setKind(k)} />
                  {k === 'creature' ? 'NPC' : 'Object'}
                </label>
              ))}
            </div>
            <input type="search" className="place-dialog__search" aria-label="Find by name or ID" placeholder="Type a name or ID" autoFocus value={text} onChange={(e) => setText(e.target.value)} />
            <ul className="place-dialog__list" aria-label="Matches">
              {hits.map((hit) => (
                <li key={hit.id}>
                  <button type="button" className="place-dialog__hit" onClick={() => setChosen({ entry: hit.id, name: hit.name || `${word} ${hit.id}` })}>
                    {hit.name || `${word} ${hit.id}`}
                    <span className="place-dialog__detail">
                      {hit.detail ? `${hit.detail} · ` : ''}#{hit.id}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {searched && !error && hits.length === 0 && <p className="place-dialog__note">Nothing in the database matches.</p>}
            {error && <p className="place-dialog__note">{error}</p>}
          </>
        )}
        {chosen && (
          <>
            <p className="find-dialog__title">
              <button type="button" className="btn" onClick={() => setChosen(null)}>
                ‹ Back
              </button>{' '}
              <strong>{chosen.name}</strong> <span className="place-dialog__detail">#{chosen.entry}</span>
            </p>
            {problem && <p className="place-dialog__note">{problem}</p>}
            {!problem && spawns === null && <p className="place-dialog__note">Looking for its spawns…</p>}
            {spawns && spawns.length === 0 && <p className="place-dialog__note">This {word} has no spawns in the database.</p>}
            {spawns && spawns.length > 0 && (
              <ul className="place-dialog__list" aria-label="Spawns">
                {spawns.map((spawn) => (
                  <SpawnRow key={`${spawn.kind}:${spawn.guid}`} spawn={spawn} from={from} onGo={() => onGo(spawn)} />
                ))}
              </ul>
            )}
            {capped && <p className="place-dialog__note">Only the first spawns are listed.</p>}
          </>
        )}
      </div>
    </div>
  );
}

function SpawnRow({ spawn, from, onGo }: { spawn: FoundSpawn; from: { map: number; x: number; y: number; z: number }; onGo(): void }): React.JSX.Element {
  const map = worldMapById(spawn.map);
  const drawn = map !== null;
  const tags = [
    spawn.note === 'placed' && 'placed in the 3D view',
    spawn.note === 'moved' && 'moved in the 3D view',
    spawn.event && `only during ${spawn.event.name || `event ${spawn.event.id}`}`,
  ].filter(Boolean);
  return (
    <li className="find-dialog__row">
      <span>
        Spawn {spawn.guid} · {map?.name ?? `Map ${spawn.map}`}
        <span className="place-dialog__detail">
          {' '}
          X {spawn.x.toFixed(1)} · Y {spawn.y.toFixed(1)} · Z {spawn.z.toFixed(1)}
          {spawn.map === from.map && ` · ${Math.round(distance(spawn, from))} yards away`}
          {tags.length > 0 && ` · ${tags.join(' · ')}`}
          {!drawn && ' · not drawn in 3D yet'}
        </span>
      </span>
      <button type="button" className="btn" disabled={!drawn} aria-label={`Go to spawn ${spawn.guid}`} onClick={onGo}>
        Go
      </button>
    </li>
  );
}

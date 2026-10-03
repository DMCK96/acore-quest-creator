import { useMemo, useRef, useState } from 'react';
import { worldMapById } from '@core/map/world-maps';
import type { TeleportSpot } from '@core/map/teleports';
import spots from '@core/map/teleports.json';
import { trapTab } from '../components/trap-tab';
import '../views/ProjectDialog.css';

/** Search results shown at once: enough to scan, few enough to stay quick */
const MAX_RESULTS = 200;

type Zone = { zone: string; spots: TeleportSpot[] };
type Region = { region: string; zones: Zone[] };

/** Spots grouped by region, then zone, in the table's order */
function group(list: readonly TeleportSpot[]): Region[] {
  const regions: Region[] = [];
  for (const spot of list) {
    let region = regions.find((r) => r.region === spot.region);
    if (!region) regions.push((region = { region: spot.region, zones: [] }));
    let zone = region.zones.find((z) => z.zone === spot.zone);
    if (!zone) region.zones.push((zone = { zone: spot.zone, spots: [] }));
    zone.spots.push(spot);
  }
  return regions;
}

/**
 * Named places to jump the 3D view to (AzerothAdmin's teleport list): search by place or zone, or
 * browse by region. Places on maps the 3D view does not draw yet (dungeons, battlegrounds) are listed
 * but cannot be picked.
 */
export function TeleportDialog({ onPick, onClose }: { onPick(spot: TeleportSpot): void; onClose(): void }): React.JSX.Element {
  const dialog = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const all = spots as TeleportSpot[];
  const browse = useMemo(() => group(all), [all]);
  const found = useMemo(() => {
    const words = query.trim().toLowerCase();
    if (!words) return null;
    return all.filter((s) => s.name.toLowerCase().includes(words) || s.zone.toLowerCase().includes(words));
  }, [all, query]);

  const spotButton = (spot: TeleportSpot, i: number) => {
    const drawn = worldMapById(spot.map) !== null;
    return (
      <li key={`${spot.name}:${i}`}>
        <button type="button" className="teleport__spot" disabled={!drawn} onClick={() => onPick(spot)}>
          {spot.name}
          {!drawn && <span className="teleport__note"> Not drawn in 3D yet</span>}
        </button>
      </li>
    );
  };
  const zoneList = (zones: Zone[]) =>
    zones.map((zone) => (
      <section key={zone.zone} className="teleport__zone">
        <h4>{zone.zone}</h4>
        <ul>{zone.spots.map(spotButton)}</ul>
      </section>
    ));

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={dialog} className="modal teleport" role="dialog" aria-modal="true" aria-label="Teleport" onKeyDown={(e) => trapTab(e, dialog.current)}>
        <header className="modal__header">
          <h2>Teleport</h2>
          <button type="button" className="btn btn--icon" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        <input
          type="search"
          className="teleport__search"
          aria-label="Find a place"
          placeholder="Find a place or zone"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="teleport__list">
          {found === null &&
            browse.map((region) => (
              <details key={region.region} className="teleport__region">
                <summary>{region.region}</summary>
                {zoneList(region.zones)}
              </details>
            ))}
          {found !== null && found.length === 0 && <p>No place matches.</p>}
          {found !== null && found.length > 0 && (
            <>
              {found.length > MAX_RESULTS && (
                <p className="teleport__note">
                  Showing the first {MAX_RESULTS} of {found.length}. Type more to narrow it down.
                </p>
              )}
              {group(found.slice(0, MAX_RESULTS)).map((region) => (
                <section key={region.region}>
                  <h3 className="teleport__region-title">{region.region}</h3>
                  {zoneList(region.zones)}
                </section>
              ))}
            </>
          )}
        </div>
        <p className="teleport__credit">Places from AzerothAdmin&apos;s teleport list.</p>
      </div>
    </div>
  );
}

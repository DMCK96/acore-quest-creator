import { useRef } from 'react';
import { stopsOf, templateOf, type RouteStop } from '@core/map/transport-view';
import { isTerrainMap, type WorldMap } from '@core/map/world-maps';
import { placeName } from '@core/map/stop-names';
import type { TeleportSpot } from '@core/map/teleports';
import spots from '@core/map/teleports.json';
import { trapTab } from '../components/trap-tab';

export interface VesselStopsProps {
  /** The vessel's transport map */
  map: WorldMap;
  /** The route it runs */
  template: number;
  /** A continent's name, for a stop with no named place near */
  hostName(map: number): string;
  /** The stop the camera goes to */
  onGoTo(stop: RouteStop): void;
  onClose(): void;
}

/** The stops of a clicked ship or zeppelin, in the order it runs them; choosing one takes the camera there. */
export function VesselStops({ map, template, hostName, onGoTo, onClose }: VesselStopsProps): React.JSX.Element {
  const dialog = useRef<HTMLDivElement>(null);
  const stops = stopsOf(map, template, (at) => placeName(at, spots as TeleportSpot[], hostName(at.map)), isTerrainMap);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialog}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Stops"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          trapTab(e, dialog.current);
        }}
      >
        <header className="modal__header">
          <h2>{templateOf(map, { template, node: 0 }).name}</h2>
          <button type="button" className="btn btn--icon" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        {stops.length === 0 ? (
          <p className="scene-hint">This route has no stops the World can show.</p>
        ) : (
          <ol className="entity-list" aria-label="Stops in route order">
            {stops.map((stop, index) => (
              <li key={stop.node} className="entity-row">
                <button type="button" className="btn" onClick={() => onGoTo(stop)}>
                  {index + 1}. {stop.label}
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

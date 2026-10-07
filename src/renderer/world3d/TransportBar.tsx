import { isTerrainMap, type WorldMap } from '@core/map/world-maps';
import { nodeOptions, nodesOf, normaliseView, type NodeOption, type TransportView } from '@core/map/transport-view';

export interface TransportBarProps {
  /** A transport's map */
  map: WorldMap;
  view: TransportView;
  /** A continent's name, for labelling the stops */
  hostName(map: number): string;
  onView(view: TransportView): void;
}

/**
 * The bar over the World on a transport: which route the vessel runs (only when its map has several) and
 * which of its stops or points it is shown at. Routes are the game's own and read-only.
 */
export function TransportBar({ map, view, hostName, onView }: TransportBarProps): React.JSX.Element {
  const templates = map.transport?.templates ?? [];
  // Only the nodes over terrain the World draws can be shown
  const nodes = nodesOf(map, view);
  const options = nodeOptions(map, view, hostName).filter((o) => isTerrainMap(nodes[o.node]!.map));
  const group = (label: string, list: NodeOption[]): React.JSX.Element | null =>
    list.length === 0 ? null : (
      <optgroup label={label}>
        {list.map((o) => (
          <option key={o.node} value={o.node}>
            {o.label}
          </option>
        ))}
      </optgroup>
    );
  return (
    <section className="world3d__transport glass" aria-label="Transport">
      {templates.length > 1 && (
        <label className="world3d__transport-field">
          <span>Route</span>
          <select aria-label="Route" value={view.template} onChange={(e) => onView(normaliseView(map, { template: Number(e.target.value) }, isTerrainMap))}>
            {templates.map((t) => (
              <option key={t.entry} value={t.entry}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="world3d__transport-field">
        <span>Stop</span>
        <select aria-label="Stop" value={view.node} onChange={(e) => onView({ template: view.template, node: Number(e.target.value) })}>
          {group('Stops', options.filter((o) => o.stop))}
          {group('Other points', options.filter((o) => !o.stop))}
        </select>
      </label>
      <p className="world3d__transport-note">Routes come from the game files and can't be edited here.</p>
    </section>
  );
}

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { circleOutline, GRID_SIZE, LEAFLET_TRANSFORM, MAX_VIEW_ZOOM, MAX_ZOOM, MIN_ZOOM } from '@core/map/coords';
import type { QuestMarker } from '@core/map/positions';
import type { MapBox, SpawnDot } from '@shared/ipc';

/**
 * The one place that touches Leaflet: a map of one WoW map drawn from the relief tiles, with the
 * quest's markers, spawn dots and zone names. Positions go in and out as world X (north) and Y
 * (west): Leaflet's lat is X and its lng is Y, under a transformation that puts north up.
 */

export type MapMarkerView = QuestMarker & { readOnlyRole?: 'giver' | 'ender' | 'objective' };

/** Where the map is asked to look; each new `seq` moves it, even to the same point again. */
export interface MapView {
  x: number;
  y: number;
  seq: number;
}

/** A patrol drawn as a closed line; only the one being edited takes clicks. */
export interface MapRoute {
  id: string;
  points: { x: number; y: number }[];
  facings: { x: number; y: number; o: number }[];
  active: boolean;
}

/** How long a facing tick is, in yards. */
const FACING_TICK = 4;

export interface LeafletMapProps {
  map: number;
  view: MapView;
  zoom: number;
  markers: MapMarkerView[];
  dots: SpawnDot[];
  zones: { name: string; x: number; y: number }[];
  selectedId: string | null;
  onMarkerMoved(id: string, at: { x: number; y: number }): void;
  onMapClick(at: { x: number; y: number }): void;
  onMarkerSelected(id: string): void;
  onViewChanged(box: MapBox, zoom: number): void;
  routes?: MapRoute[];
  onRouteClick?(routeId: string, at: { x: number; y: number }): void;
  onMarkerContextMenu?(id: string, screen: { x: number; y: number }): void;
  /** True when the click was used (picking an object); otherwise it also counts as a click on the map. */
  onDotClick?(dot: SpawnDot): boolean;
}

const HALF = 32 * GRID_SIZE;
const CRS = L.extend({}, L.CRS.Simple, { transformation: new L.Transformation(...LEAFLET_TRANSFORM) }) as L.CRS;

/** Each tile's edges drawn as faint lines: at full zoom one tile is one of the server's grids. */
const GridLines = L.GridLayer.extend({
  createTile(): HTMLElement {
    const tile = document.createElement('div');
    tile.className = 'quest-map__gridline';
    return tile;
  },
}) as unknown as new (options: L.GridLayerOptions) => L.GridLayer;

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** A patrol point shows its number only: full labels on a short route pile on top of each other. */
const shownLabel = (marker: MapMarkerView): string =>
  marker.kind === 'patrolPoint' ? String(Number(marker.id.split(':')[3]) + 1) : marker.label;

function iconFor(marker: MapMarkerView, selected: boolean): L.DivIcon {
  const kind = marker.readOnlyRole ? 'ref' : marker.kind;
  return L.divIcon({
    className: `quest-map__marker quest-map__marker--${kind}${selected ? ' quest-map__marker--selected' : ''}`,
    html: `<span class="quest-map__pin"></span><span class="quest-map__label">${escapeHtml(shownLabel(marker))}</span>`,
    iconSize: undefined,
    iconAnchor: [6, 6],
  });
}

export function LeafletMap(props: LeafletMapProps): React.JSX.Element {
  const host = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tiles = useRef<L.TileLayer | null>(null);
  const markerLayers = useRef(new Map<string, { marker: L.Marker; extra: L.Layer | null; look: string; shape: string }>());
  const dotLayer = useRef<L.LayerGroup | null>(null);
  const dotRenderer = useRef<L.Canvas | null>(null);
  const zoneLayer = useRef<L.LayerGroup | null>(null);
  const routeLayer = useRef<L.LayerGroup | null>(null);
  // Leaflet keeps the handlers it was given; these always call the latest props.
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    if (!host.current) return undefined;
    const map = L.map(host.current, {
      crs: CRS, minZoom: MIN_ZOOM, maxZoom: MAX_VIEW_ZOOM, zoomSnap: 1, attributionControl: false,
      maxBounds: L.latLngBounds([-HALF, -HALF], [HALF, HALF]),
    });
    map.on('click', (e: L.LeafletMouseEvent) => latest.current.onMapClick({ x: e.latlng.lat, y: e.latlng.lng }));
    map.on('moveend', () => {
      const b = map.getBounds();
      latest.current.onViewChanged({ minX: b.getSouth(), maxX: b.getNorth(), minY: b.getWest(), maxY: b.getEast() }, map.getZoom());
    });
    // After the handlers, so the first view is reported too and its spawns load without a pan.
    map.setView([latest.current.view.x, latest.current.view.y], latest.current.zoom);
    // Grid lines under the relief, so a map without terrain (no server data folder) still has a scale.
    new GridLines({ tileSize: 256, minZoom: MIN_ZOOM, maxZoom: MAX_VIEW_ZOOM, maxNativeZoom: MAX_ZOOM, noWrap: true }).addTo(map);
    dotLayer.current = L.layerGroup().addTo(map);
    // One canvas for every spawn dot: thousands of SVG circles make panning crawl.
    dotRenderer.current = L.canvas({ padding: 0.5 });
    host.current.dataset.dotCount = '0';
    zoneLayer.current = L.layerGroup().addTo(map);
    routeLayer.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    const layers = markerLayers.current;
    return () => {
      map.remove();
      mapRef.current = null;
      layers.clear();
    };
  }, []);

  // The relief of the map shown.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    tiles.current?.remove();
    tiles.current = L.tileLayer(`acqc-map://tile/${props.map}/{z}/{x}/{y}.png`, {
      tileSize: 256, minZoom: MIN_ZOOM, maxZoom: MAX_VIEW_ZOOM, minNativeZoom: MIN_ZOOM, maxNativeZoom: MAX_ZOOM, noWrap: true,
      bounds: L.latLngBounds([-HALF, -HALF], [HALF, HALF]),
    }).addTo(map);
  }, [props.map]);

  const { seq } = props.view;
  useEffect(() => {
    const { x, y } = latest.current.view;
    mapRef.current?.setView([x, y], mapRef.current.getZoom() || latest.current.zoom);
  }, [seq]);

  // Markers are kept by id and updated in place, so a drag does not redraw the others.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const layers = markerLayers.current;
    const wanted = new Set(props.markers.map((m) => m.id));
    for (const [id, layer] of layers) {
      if (wanted.has(id)) continue;
      layer.marker.remove();
      layer.extra?.remove();
      layers.delete(id);
    }
    for (const m of props.markers) {
      const selected = m.id === props.selectedId;
      // Replacing a marker's icon replaces its element, which would drop a drag in progress, so the
      // icon and the area or outline drawn with it change only when what they show changes.
      const look = `${m.kind}|${m.readOnlyRole ?? ''}|${m.label}|${selected}`;
      const shape = JSON.stringify([m.x, m.y, m.radius ?? null, m.outline ?? null]);
      let layer = layers.get(m.id);
      if (!layer) {
        const marker = L.marker([m.x, m.y], { draggable: m.draggable, icon: iconFor(m, selected), keyboard: true, title: m.label });
        marker.on('dragend', () => {
          const at = marker.getLatLng();
          latest.current.onMarkerMoved(m.id, { x: at.lat, y: at.lng });
        });
        marker.on('click', () => latest.current.onMarkerSelected(m.id));
        marker.on('contextmenu', (e: L.LeafletMouseEvent) => {
          L.DomEvent.preventDefault(e.originalEvent);
          latest.current.onMarkerContextMenu?.(m.id, { x: e.originalEvent.clientX, y: e.originalEvent.clientY });
        });
        marker.addTo(map);
        layer = { marker, extra: null, look, shape: '' };
        layers.set(m.id, layer);
      } else {
        const at = layer.marker.getLatLng();
        if (at.lat !== m.x || at.lng !== m.y) layer.marker.setLatLng([m.x, m.y]);
        if (layer.look !== look) {
          layer.marker.setIcon(iconFor(m, selected));
          layer.look = look;
        }
      }
      if (layer.shape === shape) continue;
      layer.shape = shape;
      layer.extra?.remove();
      // An area as a polygon: Leaflet sizes circles from the x axis, which this map mirrors.
      layer.extra = m.radius
        ? L.polygon(circleOutline(m.x, m.y, m.radius).map((p) => [p.x, p.y] as [number, number]), { className: 'quest-map__area' }).addTo(map)
        : m.outline
          ? L.polygon(m.outline.map((p) => [p.x, p.y] as [number, number]), { className: 'quest-map__poi' }).addTo(map)
          : null;
    }
  }, [props.markers, props.selectedId]);

  useEffect(() => {
    const group = dotLayer.current;
    if (!group) return;
    group.clearLayers();
    for (const dot of props.dots) {
      L.circleMarker([dot.x, dot.y], {
        renderer: dotRenderer.current ?? undefined,
        radius: 3,
        color: '#1a1208',
        weight: 1,
        fillColor: dot.kind === 'creature' ? '#f2d16b' : '#8fd3e8',
        fillOpacity: 0.85,
        interactive: true,
      })
        .bindTooltip(dot.name || `#${dot.entry}`)
        .on('click', (e: L.LeafletMouseEvent) => {
          // A dot picked for something must not also count as a click on the map under it.
          if (latest.current.onDotClick?.(dot)) L.DomEvent.stopPropagation(e);
        })
        .addTo(group);
    }
    if (host.current) host.current.dataset.dotCount = String(props.dots.length);
  }, [props.dots]);

  useEffect(() => {
    const group = routeLayer.current;
    if (!group) return;
    group.clearLayers();
    for (const route of props.routes ?? []) {
      const loop = [...route.points, route.points[0]!].map((p) => [p.x, p.y] as [number, number]);
      const line = L.polyline(loop, {
        className: route.active ? 'quest-map__route' : 'quest-map__route quest-map__route--idle',
        interactive: route.active,
      });
      if (route.active) {
        line.on('click', (e: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(e);
          latest.current.onRouteClick?.(route.id, { x: e.latlng.lat, y: e.latlng.lng });
        });
      }
      line.addTo(group);
      for (const f of route.facings) {
        L.polyline([[f.x, f.y], [f.x + FACING_TICK * Math.cos(f.o), f.y + FACING_TICK * Math.sin(f.o)]], {
          className: 'quest-map__facing', interactive: false,
        }).addTo(group);
      }
    }
  }, [props.routes]);

  useEffect(() => {
    const group = zoneLayer.current;
    if (!group) return;
    group.clearLayers();
    for (const zone of props.zones) {
      L.marker([zone.x, zone.y], {
        interactive: false,
        icon: L.divIcon({ className: 'quest-map__zone', html: escapeHtml(zone.name), iconSize: undefined }),
      }).addTo(group);
    }
  }, [props.zones]);

  return <div ref={host} className="quest-map__canvas" />;
}

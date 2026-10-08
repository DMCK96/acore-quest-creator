/**
 * A transport's route in the 3D view: a line through each run of nodes on the host map and a ball on each
 * stop. Drawn over the sea and the vessel, in the colour NPC patrol routes use. Markers are not pickable.
 */
import * as THREE from 'three';
import type { RouteLine as RouteData } from '../../../../core/map/transport-view';

/** The patrol-route colour (spawn/paths.ts) */
const ROUTE_COLOUR = 0xf0d060;
/** Stop marker radius, in yards */
const STOP_RADIUS = 2;
const RENDER_ORDER = 2;

export function buildRouteLines(lines: readonly RouteData[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'transport-route';
  const lineMaterial = new THREE.LineBasicMaterial({ color: ROUTE_COLOUR, depthTest: false });
  const stopMaterial = new THREE.MeshBasicMaterial({ color: ROUTE_COLOUR, depthTest: false });
  const stopGeometry = new THREE.SphereGeometry(STOP_RADIUS, 12, 8);
  for (const run of lines) {
    if (run.points.length >= 2) {
      const geometry = new THREE.BufferGeometry().setFromPoints(run.points.map((p) => new THREE.Vector3(p.x, p.y, p.z)));
      const line = new THREE.Line(geometry, lineMaterial);
      line.name = 'route';
      line.renderOrder = RENDER_ORDER;
      group.add(line);
    }
    for (const stop of run.stops) {
      const marker = new THREE.Mesh(stopGeometry, stopMaterial);
      marker.name = 'stop';
      marker.position.set(stop.x, stop.y, stop.z);
      marker.renderOrder = RENDER_ORDER;
      group.add(marker);
    }
  }
  return group;
}

/** Frees every geometry and material in the group (each once) and empties it. */
export function disposeRouteLines(group: THREE.Group): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  for (const child of group.children) {
    const drawn = child as THREE.Mesh;
    geometries.add(drawn.geometry);
    materials.add(drawn.material as THREE.Material);
  }
  for (const g of geometries) g.dispose();
  for (const m of materials) m.dispose();
  group.clear();
}

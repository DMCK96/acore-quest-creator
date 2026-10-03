// @ts-nocheck
/**
 * How NPCs move, drawn in the 3D view: a patrol route as a line from the spawn through each point and
 * back to the first, with a ball at each point and an arrow along each leg; a wander circle at the
 * wander radius round the spawn. Drawn over the terrain, so a route on uneven ground stays visible.
 * Everything is in world coordinates.
 */
import * as THREE from 'three';

const PATH_COLOUR = 0xf0d060;
const OWN_COLOUR = 0x60e0a0;

const POINT_RADIUS = 0.35;
const ARROW = { radius: 0.4, length: 1 };
const WANDER_SEGMENTS = 48;
/** A wander circle sits this far above its spawn point, so it does not sink into the ground */
const WANDER_LIFT = 0.2;
/** Routes draw after the world, through terrain bumps */
const RENDER_ORDER = 2;

const pointGeometry = new THREE.SphereGeometry(POINT_RADIUS, 8, 6);
const arrowGeometry = new THREE.ConeGeometry(ARROW.radius, ARROW.length, 8);
const Y = new THREE.Vector3(0, 1, 0);

const materials = new globalThis.Map<number, { line: THREE.LineBasicMaterial; mesh: THREE.MeshBasicMaterial }>();
const materialsFor = (own: boolean) => {
  const colour = own ? OWN_COLOUR : PATH_COLOUR;
  let m = materials.get(colour);
  if (!m) {
    m = {
      line: new THREE.LineBasicMaterial({ color: colour, depthTest: false }),
      mesh: new THREE.MeshBasicMaterial({ color: colour, depthTest: false }),
    };
    materials.set(colour, m);
  }
  return m;
};

type Point = { x: number; y: number; z: number };

/** A patrol route, or null for an NPC without one */
const routeObject = (creature: { x: number; y: number; z: number; path: Point[] | null; own: boolean }): THREE.Group | null => {
  const path = creature.path;
  if (!path || path.length === 0) {
    return null;
  }

  const { line, mesh } = materialsFor(creature.own);
  const stops = [{ x: creature.x, y: creature.y, z: creature.z }, ...path, path[0]].map((p) => new THREE.Vector3(p.x, p.y, p.z));

  const group = new THREE.Group();
  group.name = 'route';

  const route = new THREE.Line(new THREE.BufferGeometry().setFromPoints(stops), line);
  route.renderOrder = RENDER_ORDER;
  group.add(route);

  for (const p of path) {
    const ball = new THREE.Mesh(pointGeometry, mesh);
    ball.position.set(p.x, p.y, p.z);
    ball.renderOrder = RENDER_ORDER;
    group.add(ball);
  }

  for (let i = 0; i + 1 < stops.length; i++) {
    const direction = stops[i + 1].clone().sub(stops[i]);
    if (direction.lengthSq() === 0) {
      continue;
    }
    const arrow = new THREE.Mesh(arrowGeometry, mesh);
    arrow.position.copy(stops[i]).add(stops[i + 1]).multiplyScalar(0.5);
    arrow.quaternion.setFromUnitVectors(Y, direction.normalize());
    arrow.renderOrder = RENDER_ORDER;
    group.add(arrow);
  }

  group.updateMatrixWorld(true);
  return group;
};

/** A wander circle, or null for an NPC that stands still */
const wanderObject = (creature: { x: number; y: number; z: number; wander: number; own: boolean }): THREE.LineLoop | null => {
  if (!(creature.wander > 0)) {
    return null;
  }

  const points = [];
  for (let i = 0; i < WANDER_SEGMENTS; i++) {
    const angle = (i / WANDER_SEGMENTS) * Math.PI * 2;
    points.push(
      new THREE.Vector3(
        creature.x + Math.cos(angle) * creature.wander,
        creature.y + Math.sin(angle) * creature.wander,
        creature.z + WANDER_LIFT,
      ),
    );
  }

  const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), materialsFor(creature.own).line);
  ring.name = 'wander';
  ring.renderOrder = RENDER_ORDER;
  ring.updateMatrixWorld(true);
  return ring;
};

export { OWN_COLOUR, PATH_COLOUR, routeObject, wanderObject };

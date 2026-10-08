/**
 * How NPCs move, drawn in the 3D view: a patrol route as a line from the spawn through each point and
 * back to the first, with a ball at each point and an arrow along each leg; a wander circle at the
 * wander radius round the spawn. Drawn over the terrain, so a route on uneven ground stays visible.
 * Everything is in world coordinates.
 */
import * as THREE from 'three';

const PATH_COLOUR = 0xf0d060;
const OWN_COLOUR = 0x60e0a0;
/** A picked point: the selection's gold, and larger */
const SELECTED_COLOUR = 0xffd34d;
const SELECTED_SCALE = 1.6;

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

let selectedMaterial: THREE.MeshBasicMaterial | null = null;

/** An arrow along each leg that has a length, from each stop to the next */
const addArrows = (group: THREE.Group, stops: THREE.Vector3[], mesh: THREE.Material) => {
  for (let i = 0; i + 1 < stops.length; i++) {
    const direction = stops[i + 1].clone().sub(stops[i]);
    if (direction.lengthSq() === 0) {
      continue;
    }
    const arrow = new THREE.Mesh(arrowGeometry, mesh);
    arrow.position.copy(stops[i]).add(stops[i + 1]).multiplyScalar(0.5);
    arrow.quaternion.setFromUnitVectors(Y, direction.normalize());
    arrow.renderOrder = RENDER_ORDER;
    // So a redraw while dragging can find and replace it
    arrow.userData.arrow = true;
    group.add(arrow);
  }
};

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
  // Its arrows' look, for a redraw while dragging
  group.userData.mesh = mesh;

  const route = new THREE.Line(new THREE.BufferGeometry().setFromPoints(stops), line);
  route.renderOrder = RENDER_ORDER;
  group.add(route);

  path.forEach((p, index) => {
    const ball = new THREE.Mesh(pointGeometry, mesh);
    ball.position.set(p.x, p.y, p.z);
    // Which point it is, so a click on it can pick the point
    ball.userData.point = index;
    // Its own look, to go back to once it is no longer picked
    ball.userData.plain = mesh;
    ball.renderOrder = RENDER_ORDER;
    group.add(ball);
  });

  addArrows(group, stops, mesh);

  group.updateMatrixWorld(true);
  // Moved only by `moveRouteDrawing`, which works its matrices out: the scene's every-frame pass skips it and its hundreds of points
  group.matrixWorldAutoUpdate = false;
  return group;
};

/**
 * Moves a drawn route to new points in place (the line, each ball and the arrows), while its points
 * are dragged; cheaper than drawing the whole area again every frame
 */
const moveRouteDrawing = (group: THREE.Group, home: Point, points: Point[]): void => {
  const stops = [home, ...points, points[0]].map((p) => new THREE.Vector3(p.x, p.y, p.z));
  for (const child of [...group.children]) {
    if (child.userData.arrow) {
      // The geometry and material are shared by every arrow, so they stay
      group.remove(child);
    } else if (typeof child.userData.point === 'number') {
      const p = points[child.userData.point];
      if (p) child.position.set(p.x, p.y, p.z);
    } else if (child instanceof THREE.Line) {
      child.geometry.dispose();
      child.geometry = new THREE.BufferGeometry().setFromPoints(stops);
    }
  }
  addArrows(group, stops, group.userData.mesh);
  group.updateMatrixWorld(true);
};

/** Marks a route point as picked (larger, in the selection's colour) or not */
const setBallSelected = (ball: THREE.Mesh, selected: boolean): void => {
  if (selected) {
    selectedMaterial ??= new THREE.MeshBasicMaterial({ color: SELECTED_COLOUR, depthTest: false });
    ball.material = selectedMaterial;
    ball.scale.setScalar(SELECTED_SCALE);
  } else {
    ball.material = ball.userData.plain ?? ball.material;
    ball.scale.setScalar(1);
  }
  ball.updateMatrixWorld(true);
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
  // Never moved: the scene's every-frame matrix pass skips it
  ring.matrixWorldAutoUpdate = false;
  return ring;
};

export { OWN_COLOUR, PATH_COLOUR, moveRouteDrawing, routeObject, setBallSelected, wanderObject };

import { useEffect, useRef, useState } from 'react';
import { assetUrl } from '@core/client/asset-url';
import { worldMapDirectory } from '@core/map/world-maps';
import { createWorld3D, type World3D } from './world3d';
import './world3d.css';

/**
 * The 3D view of one map, looking at a point. It needs the game client's folder (the terrain and
 * models are read from it) and a map the client has terrain for.
 */
export function World3DView({
  map,
  start,
  hasClient,
}: {
  map: number;
  start: { x: number; y: number; z: number };
  hasClient: boolean;
}): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null);
  const world = useRef<World3D | null>(null);
  const startRef = useRef(start);
  startRef.current = start;
  const [area, setArea] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const directory = worldMapDirectory(map);

  useEffect(() => {
    const element = container.current;
    if (!element || !directory || !hasClient) return;
    setProblem(null);
    setArea(null);
    let live = true;
    let created: World3D | null = null;
    // The client may not have this map's terrain (a server-only map, a folder that is not a client):
    // say so, instead of drawing an empty world.
    void fetch(assetUrl(`world/maps/${directory}/${directory}.wdt`))
      .then((r) => r.ok)
      .catch(() => false)
      .then((found) => {
        if (!live) return;
        if (!found) {
          setProblem('The game client has no terrain for this map. Check the game client folder in the connection settings.');
          return;
        }
        created = createWorld3D({ container: element, directory, map, start: startRef.current, onArea: setArea, onError: setProblem });
        world.current = created;
      });
    return () => {
      live = false;
      created?.dispose();
      world.current = null;
    };
  }, [directory, map, hasClient]);

  // A different point to look at (another marker chosen) moves the camera without rebuilding the world.
  useEffect(() => {
    world.current?.lookAt(start.x, start.y, start.z);
  }, [start.x, start.y, start.z]);

  const unavailable = !hasClient
    ? 'Choose the game client folder in the connection settings to see the world in 3D.'
    : !directory
      ? 'The 3D view draws the four continents; this map is not one of them.'
      : null;

  return (
    <div className="world3d" aria-label="3D view">
      <div ref={container} className="world3d__stage" />
      {area && <p className="world3d__area">{area}</p>}
      {(unavailable ?? problem) && (
        <p role="status" className="world3d__note">
          {unavailable ?? problem}
        </p>
      )}
    </div>
  );
}

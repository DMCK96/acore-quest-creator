import { useEffect, useState } from 'react';
import { WORLD_MAPS, worldMapById } from '@core/map/world-maps';
import { World3DView } from './World3DView';
import './world3d.css';

/**
 * The 3D view on its own, without a quest: pick a continent, go to a place, look around. It is
 * where the world is edited in 3D; a quest's markers join it as the editor grows.
 */
export function World3DScreen({ hasClient, onClose }: { hasClient: boolean; onClose(): void }): React.JSX.Element {
  const [mapId, setMapId] = useState(WORLD_MAPS[0]!.id);
  const [at, setAt] = useState(WORLD_MAPS[0]!.start);
  // The coordinates being typed; they only move the camera on Go.
  const [typed, setTyped] = useState({ x: String(at.x), y: String(at.y), z: String(at.z) });

  const goTo = (point: { x: number; y: number; z: number }): void => {
    setAt(point);
    setTyped({ x: String(point.x), y: String(point.y), z: String(point.z) });
  };
  const chooseMap = (id: number): void => {
    setMapId(id);
    goTo(worldMapById(id)!.start);
  };
  const parsed = { x: Number(typed.x), y: Number(typed.y), z: Number(typed.z) };
  const valid = [typed.x, typed.y, typed.z].every((v) => v.trim() !== '') && Object.values(parsed).every(Number.isFinite);

  // Escape closes this before anything under it (a quest editor listens on the document too).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  const field = (axis: 'x' | 'y' | 'z'): React.JSX.Element => (
    <label className="scene-field world3d-screen__coordinate">
      <span>{axis.toUpperCase()}</span>
      <input type="number" step="any" value={typed[axis]} onChange={(e) => setTyped((t) => ({ ...t, [axis]: e.target.value }))} />
    </label>
  );

  return (
    <div role="dialog" aria-label="3D view" className="world3d-screen">
      <header className="world3d-screen__header">
        <h2 className="world3d-screen__title">3D view</h2>
        <label className="scene-field">
          <span>Map</span>
          <select value={mapId} onChange={(e) => chooseMap(Number(e.target.value))}>
            {WORLD_MAPS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <form
          className="world3d-screen__goto"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) setAt(parsed);
          }}
        >
          {field('x')}
          {field('y')}
          {field('z')}
          <button type="submit" className="btn" disabled={!valid}>
            Go
          </button>
        </form>
        <button type="button" className="btn world3d-screen__close" onClick={onClose}>
          Close
        </button>
      </header>
      <div className="world3d-screen__body">
        <World3DView map={mapId} start={at} hasClient={hasClient} />
      </div>
    </div>
  );
}

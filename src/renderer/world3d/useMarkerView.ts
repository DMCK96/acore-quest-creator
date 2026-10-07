import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { World3D, World3DOptions } from './world3d';
import type { WorldMarker } from './quest-markers';

type At = { x: number; y: number; z: number };

/** A marker the host asks the view to select; each request is its own, even of the same marker */
export type MarkerFocus = { id: string; nonce: number };

/**
 * The open quest's markers in a 3D view: drawn in each world it builds (and taken away once there are
 * none), the one clicked or asked for selected, and a drag of one handed to the host.
 */
export function useMarkerView({ world, markers = [], focus, onMove }: {
  world: RefObject<World3D | null>;
  markers?: readonly WorldMarker[];
  focus?: MarkerFocus;
  onMove?(id: string, to: At): void;
}): {
  /** The world's marker callbacks, for `createWorld3D` */
  options: Pick<World3DOptions, 'onMarkerSelect' | 'onMarkerMove'>;
  /** Draws the markers in a world just built, and selects one asked for before it was there */
  attach(created: World3D): void;
  selected: WorldMarker | null;
  clear(): void;
} {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const markersRef = useRef(markers);
  markersRef.current = markers;
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  // Whether the world shows any markers, so an empty list is only sent to take them away
  const drawn = useRef(false);
  const pending = useRef<string | null>(null);

  const draw = (target: World3D): void => {
    if (markersRef.current.length === 0 && !drawn.current) return;
    drawn.current = markersRef.current.length > 0;
    target.setMarkers(markersRef.current);
  };
  const selectPending = (target: World3D): void => {
    const id = pending.current;
    if (id === null) return;
    pending.current = null;
    setSelectedId(target.selectMarker(id) ? id : null);
  };

  const key = JSON.stringify(markers);
  useEffect(() => {
    if (world.current) draw(world.current);
    // Only a change of what is drawn is sent
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!focus) return;
    pending.current = focus.id;
    if (world.current) selectPending(world.current);
    // Only a new request selects
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce]);

  const options = useMemo<Pick<World3DOptions, 'onMarkerSelect' | 'onMarkerMove'>>(() => ({
    onMarkerSelect: (id) => setSelectedId(id),
    onMarkerMove: (id, to) => onMoveRef.current?.(id, to),
  }), []);

  return {
    options,
    attach(created) {
      drawn.current = false;
      setSelectedId(null);
      draw(created);
      selectPending(created);
    },
    selected: markers.find((m) => m.id === selectedId) ?? null,
    clear() {
      world.current?.selectMarker(null);
      setSelectedId(null);
    },
  };
}

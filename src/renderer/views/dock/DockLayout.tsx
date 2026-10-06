import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { DOCK_MAX_SIZE, DOCK_MIN_SIZE, clampDockSize, type DockSide } from '../../preferences/store';
import './DockLayout.css';

const KEY_STEP = 0.05;

const round = (n: number) => Math.round(n * 1000) / 1000;

interface Props {
  open: boolean;
  side: DockSide;
  /** The dock's fraction of the container along the split axis. */
  size: number;
  /** Told the size a key or a finished divider drag left */
  onSize(size: number): void;
  main: ReactNode;
  dock: ReactNode;
}

/**
 * Main view plus a resizable dock below or beside it. Main keeps one wrapper so it never remounts. A
 * divider drag is followed here and handed on once, when it is let go, so the size is not stored and
 * the app not redrawn at every step of it.
 */
export function DockLayout({ open, side, size, onSize, main, dock }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // The size a divider drag has reached; null while none is under way
  const [dragged, setDragged] = useState<number | null>(null);
  const draggedRef = useRef<number | null>(null);
  const shown = dragged ?? size;

  const fractionAt = (e: PointerEvent): number => {
    const rect = containerRef.current!.getBoundingClientRect();
    const fraction = side === 'bottom' ? (rect.bottom - e.clientY) / rect.height : (rect.right - e.clientX) / rect.width;
    return round(clampDockSize(fraction));
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    draggedRef.current = size;
    setDragged(size);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (draggedRef.current === null) return;
    draggedRef.current = fractionAt(e);
    setDragged(draggedRef.current);
  };
  // Let go, or the pointer taken away (the window lost focus): the size it reached is kept
  const endDrag = () => {
    const reached = draggedRef.current;
    draggedRef.current = null;
    setDragged(null);
    if (reached !== null && reached !== size) onSize(reached);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const grow = side === 'bottom' ? 'ArrowUp' : 'ArrowLeft';
    const shrink = side === 'bottom' ? 'ArrowDown' : 'ArrowRight';
    if (e.key !== grow && e.key !== shrink) return;
    e.preventDefault();
    onSize(clampDockSize(round(size + (e.key === grow ? KEY_STEP : -KEY_STEP))));
  };

  return (
    <div ref={containerRef} className="dock-layout" data-side={side}>
      <div className="dock-layout__main">{main}</div>
      {open && (
        <div
          className="dock-layout__divider"
          role="separator"
          aria-orientation={side === 'right' ? 'vertical' : 'horizontal'}
          aria-valuenow={Math.round(shown * 100)}
          aria-valuemin={DOCK_MIN_SIZE * 100}
          aria-valuemax={DOCK_MAX_SIZE * 100}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onLostPointerCapture={endDrag}
          onKeyDown={onKeyDown}
        />
      )}
      {open && <div className="dock-layout__dock" style={{ flexBasis: `${shown * 100}%` }}>{dock}</div>}
    </div>
  );
}

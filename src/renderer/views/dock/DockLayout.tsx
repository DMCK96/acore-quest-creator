import { useCallback, useEffect, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import type { DockSide } from '../../preferences/store';
import './DockLayout.css';

const MIN_SIZE = 0.15;
const MAX_SIZE = 0.85;
const KEY_STEP = 0.05;

export function clampSize(n: number): number {
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, n));
}

const round = (n: number) => Math.round(n * 1000) / 1000;

interface Props {
  open: boolean;
  side: DockSide;
  /** The dock's fraction of the container along the split axis. */
  size: number;
  onSize(size: number): void;
  main: ReactNode;
  dock: ReactNode;
  /** Called after a size, side or open change, once layout has settled. */
  onResize?(): void;
}

/** Main view plus a resizable dock below or beside it. Main keeps one wrapper so it never remounts. */
export function DockLayout({ open, side, size, onSize, main, dock, onResize }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;

  useEffect(() => {
    const frame = requestAnimationFrame(() => onResizeRef.current?.());
    return () => cancelAnimationFrame(frame);
  }, [open, side, size]);

  const fractionAt = useCallback((e: PointerEvent): number => {
    const rect = containerRef.current!.getBoundingClientRect();
    const fraction = side === 'bottom' ? (rect.bottom - e.clientY) / rect.height : (rect.right - e.clientX) / rect.width;
    return clampSize(fraction);
  }, [side]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) onSize(fractionAt(e));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const grow = side === 'bottom' ? 'ArrowUp' : 'ArrowLeft';
    const shrink = side === 'bottom' ? 'ArrowDown' : 'ArrowRight';
    if (e.key !== grow && e.key !== shrink) return;
    e.preventDefault();
    onSize(clampSize(round(size + (e.key === grow ? KEY_STEP : -KEY_STEP))));
  };

  return (
    <div ref={containerRef} className="dock-layout" data-side={side}>
      <div className="dock-layout__main">{main}</div>
      {open && (
        <div
          className="dock-layout__divider"
          role="separator"
          aria-orientation={side === 'right' ? 'vertical' : 'horizontal'}
          aria-valuenow={Math.round(size * 100)}
          aria-valuemin={MIN_SIZE * 100}
          aria-valuemax={MAX_SIZE * 100}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onKeyDown={onKeyDown}
        />
      )}
      {open && <div className="dock-layout__dock" style={{ flexBasis: `${size * 100}%` }}>{dock}</div>}
    </div>
  );
}

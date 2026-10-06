import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import './ChainLinkMenu.css';

/**
 * The right-click menu of a link on the chain graph, at the cursor: one action, taking the link away
 * or opening the quest that holds it. Esc or a click outside closes it. It sits on the page, so no
 * frosted panel round the graph can shift where it lands.
 */
export function ChainLinkMenu({
  at,
  label,
  onPick,
  onClose,
}: {
  at: { x: number; y: number };
  label: string;
  onPick(): void;
  onClose(): void;
}): React.JSX.Element {
  const menu = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const outside = (e: MouseEvent): void => {
      if (menu.current && !menu.current.contains(e.target as Node)) onCloseRef.current();
    };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, []);

  return createPortal(
    <div
      ref={menu}
      role="menu"
      aria-label="Link actions"
      className="chain-link-menu glass"
      style={{ left: at.x, top: at.y }}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        onClose();
      }}
    >
      <button
        type="button"
        role="menuitem"
        className="chain-link-menu__item"
        onClick={() => {
          onClose();
          onPick();
        }}
      >
        {label}
      </button>
    </div>,
    document.body,
  );
}

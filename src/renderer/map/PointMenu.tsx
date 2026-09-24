import { useEffect, useRef } from 'react';

export type PointMenuItem =
  | 'wait' | 'face' | 'walk' | 'run'
  | 'say' | 'emote' | 'pose' | 'cast' | 'sound' | 'mount' | 'dismount' | 'useObject'
  | 'insertAfter' | 'remove';

const GROUPS: readonly (readonly (readonly [PointMenuItem, string])[])[] = [
  [['wait', 'Wait here…'], ['face', 'Face direction…'], ['walk', 'Walk from here'], ['run', 'Run from here']],
  [
    ['say', 'Say something…'], ['emote', 'Play an emote…'], ['pose', 'Hold a pose while waiting…'], ['cast', 'Cast a spell…'],
    ['sound', 'Play a sound…'], ['mount', 'Mount…'], ['dismount', 'Dismount'], ['useObject', 'Use an object…'],
  ],
  [['insertAfter', 'Insert point after'], ['remove', 'Remove point']],
];

const MENU_WIDTH = 220;
const MENU_HEIGHT = 380;

/** What a patrol point can do, opened by right-clicking it on the map. */
export function PointMenu({
  index,
  at,
  onPick,
  onClose,
}: {
  index: number;
  at: { x: number; y: number };
  onPick(item: PointMenuItem): void;
  onClose(): void;
}): React.JSX.Element {
  const menu = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const outside = (e: MouseEvent): void => {
      if (menu.current && !menu.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [onClose]);

  function onKeyDown(e: React.KeyboardEvent): void {
    // Escape closes the menu only, not the map behind it.
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    const now = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = (now + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  }

  const left = Math.max(0, Math.min(at.x, window.innerWidth - MENU_WIDTH));
  const top = Math.max(0, Math.min(at.y, window.innerHeight - MENU_HEIGHT));
  return (
    <div ref={menu} role="menu" aria-label={`Point ${index + 1}`} className="quest-map__menu" style={{ left, top }} onKeyDown={onKeyDown}>
      {GROUPS.map((group, g) => (
        <div key={g} className="quest-map__menu-group">
          {g > 0 && <div role="separator" className="quest-map__menu-separator" />}
          {group.map(([item, label]) => (
            <button key={item} type="button" role="menuitem" className="quest-map__menu-item" onClick={() => onPick(item)}>
              {label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

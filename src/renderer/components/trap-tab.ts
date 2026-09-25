/** Tab and Shift+Tab go round `container` only, never out to what sits behind a modal. */
export function trapTab(e: React.KeyboardEvent, container: HTMLElement | null): void {
  if (e.key !== 'Tab' || !container) return;
  const focusable = [...container.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]')]
    .filter((el) => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled);
  if (focusable.length === 0) {
    e.preventDefault();
    return;
  }
  const first = focusable[0]!;
  const last = focusable.at(-1)!;
  const at = document.activeElement;
  const inside = focusable.includes(at as HTMLElement);
  if (e.shiftKey && (at === first || !inside)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (at === last || !inside)) {
    e.preventDefault();
    first.focus();
  }
}

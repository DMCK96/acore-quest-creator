/**
 * A short name for an element in the debug timeline: `tag#id.firstClass[role=…]`. Nothing else about it
 * is kept, and never a value. A password field is only ever `[password]`.
 */
export function describeElement(el: Element | null, withRole = true): string | null {
  // An event target can be the window or the document, which have no tag
  if (!el || typeof el.tagName !== 'string') return null;
  if (el.tagName.toLowerCase() === 'input' && (el as HTMLInputElement).type === 'password') return '[password]';
  let text = el.tagName.toLowerCase();
  if (el.id) text += `#${el.id}`;
  const first = el.classList[0];
  if (first) text += `.${first}`;
  const role = el.getAttribute('role');
  if (withRole && role) text += `[role=${role}]`;
  return text;
}

import type { FieldState, FocusSnapshot, Rect } from '@shared/ipc';
import { describeElement } from './describe';

const TEXT_TYPES = new Set(['', 'text', 'search', 'url', 'tel', 'email', 'password', 'number']);

/** An `input` of a type that takes text, or a `textarea` */
function isTextField(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea') return true;
  return tag === 'input' && TEXT_TYPES.has((el as HTMLInputElement).type);
}

/** The element holding keyboard focus, or null when it is the page itself */
function activeOf(doc: Document): Element | null {
  const el = doc.activeElement;
  return !el || el === doc.body || el === doc.documentElement ? null : el;
}

/**
 * Where keyboard focus is and what could be stopping it from typing: the active element, whether it takes
 * text, ancestors that are inert or hidden from assistive technology, the open dialogs, and what sits over it.
 * Plain data; no field value is read.
 */
export function focusSnapshot(doc: Document): FocusSnapshot {
  const active = activeOf(doc);
  const field = active as (HTMLInputElement & HTMLElement) | null;
  const blockedBy: string[] = [];
  for (let up = active?.parentElement ?? null; up; up = up.parentElement) {
    if (up.hasAttribute('inert') || up.getAttribute('aria-hidden') === 'true') blockedBy.push(describeElement(up, false)!);
  }
  const modals = [...doc.querySelectorAll('[role=dialog], [aria-modal=true]')].map((el) => describeElement(el, false)!);

  let coveredBy: string | null = null;
  if (active && typeof doc.elementFromPoint === 'function') {
    const box = active.getBoundingClientRect();
    const top = doc.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    if (top && top !== active && !active.contains(top) && !top.contains(active)) coveredBy = describeElement(top, false);
  }

  return {
    documentHasFocus: doc.hasFocus(),
    active: describeElement(active),
    activeState: field
      ? {
          editable: (isTextField(field) && !field.disabled && !field.readOnly) || field.isContentEditable === true,
          disabled: field.disabled === true,
          readOnly: field.readOnly === true,
        }
      : null,
    blockedBy,
    modals,
    coveredBy,
  };
}

/** The focused text field and, only when asked, its value; a password is never read */
export function fieldState(doc: Document, includeValue: boolean): FieldState | null {
  const el = activeOf(doc);
  if (!isTextField(el)) return null;
  if (el.type === 'password') return { target: '[password]', value: '[password]' };
  return { target: describeElement(el)!, value: includeValue ? el.value : '' };
}

/** The window rectangle of the first element a selector matches, in whole pixels; null for none or a bad selector */
export function rectOf(doc: Document, selector: string): Rect | null {
  let el: Element | null;
  try {
    el = doc.querySelector(selector);
  } catch {
    return null;
  }
  if (!el) return null;
  const box = el.getBoundingClientRect();
  return { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) };
}

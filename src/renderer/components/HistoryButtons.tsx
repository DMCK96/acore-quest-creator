import { useEffect, useRef, useState } from 'react';
import type { StepSummary } from '@shared/ipc';
import type { AppStore } from '../state/app-store';
import './HistoryButtons.css';

const TEXT_INPUTS = new Set(['', 'text', 'search', 'email', 'url', 'tel', 'password', 'number']);

/** Whether keys pressed here belong to a text field (its own undo), not to the project */
export function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) return TEXT_INPUTS.has(target.type);
  return target.isContentEditable || target.contentEditable === 'true';
}

const KIND_LABEL: Record<StepSummary['kind'], string> = { quest: 'Quest', world: 'World', graph: 'Graph', project: 'Project', entities: 'NPCs & objects' };

/**
 * Undo and Redo for the whole project, each naming the step it would act on, and the History list:
 * every step newest first, the project's place among them marked; a click goes back or forward to it.
 */
export function HistoryButtons({ store }: { store: AppStore }): React.JSX.Element {
  const { steps, current, saved } = store((s) => s.history);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);

  const at = steps.findIndex((s) => s.id === current);
  const undoStep = at >= 0 ? steps[at] : undefined;
  const redoStep = steps[at + 1];
  const undoLabel = undoStep ? `Undo: ${undoStep.label} (Ctrl+Z)` : 'Undo (Ctrl+Z)';
  const redoLabel = redoStep ? `Redo: ${redoStep.label} (Ctrl+Y)` : 'Redo (Ctrl+Y)';

  // A click anywhere else closes the list
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent): void => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  useEffect(() => {
    if (open) items.current.find((i) => i)?.focus();
  }, [open]);

  const jump = (id: number): void => {
    setOpen(false);
    void store.getState().jumpTo(id);
  };
  const onMenuKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const list = items.current.filter((i): i is HTMLButtonElement => i !== null);
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    list[(i + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length]?.focus();
  };

  const newestFirst = [...steps].reverse();
  items.current = [];
  return (
    <div className="history" ref={wrap}>
      <button type="button" className="btn btn--icon" aria-label={undoLabel} title={undoLabel} disabled={!undoStep} onClick={() => void store.getState().undo()}>
        <svg className="app-bar__icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M5.5 3.5L2.5 6.5l3 3M2.5 6.5h7a4 4 0 0 1 0 8H7" />
        </svg>
      </button>
      <button type="button" className="btn btn--icon" aria-label={redoLabel} title={redoLabel} disabled={!redoStep} onClick={() => void store.getState().redo()}>
        <svg className="app-bar__icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M10.5 3.5l3 3-3 3M13.5 6.5h-7a4 4 0 0 0 0 8H9" />
        </svg>
      </button>
      <button type="button" className="btn btn--icon history__caret" aria-label="History" title="History" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <svg className="app-bar__icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 6.5l4 4 4-4" />
        </svg>
      </button>
      {open && (
        <div className="history__menu glass" role="menu" aria-label="History" onKeyDown={onMenuKey}>
          {steps.length === 0 ? (
            <p className="history__empty">Nothing to undo yet.</p>
          ) : (
            <>
              {newestFirst.map((step) => {
                const undone = at < 0 || steps.indexOf(step) > at;
                return (
                  <button
                    key={step.id}
                    ref={(el) => {
                      items.current.push(el);
                    }}
                    type="button"
                    role="menuitem"
                    className={`history__step${undone ? ' history__step--undone' : ''}`}
                    aria-current={step.id === current ? 'step' : undefined}
                    onClick={() => jump(step.id)}
                  >
                    <span className="history__kind">{KIND_LABEL[step.kind]}</span>
                    <span className="history__label">{step.label}</span>
                    {step.id === saved && <span className="history__saved">Saved</span>}
                  </button>
                );
              })}
              <button
                ref={(el) => {
                  items.current.push(el);
                }}
                type="button"
                role="menuitem"
                className="history__step history__step--start"
                aria-current={current === 0 ? 'step' : undefined}
                onClick={() => jump(0)}
              >
                <span className="history__label">Start of this session</span>
                {saved === 0 && <span className="history__saved">Saved</span>}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

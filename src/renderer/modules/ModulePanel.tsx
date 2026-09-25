import { useEffect, useRef, type ReactNode } from 'react';
import type { Issue } from '@core/validate/validate';
import type { ModuleId } from '@core/modules/model';
import { moduleById } from '@core/modules/catalog';
import type { ModuleBodyProps } from './body-props';
import { ModuleBody } from './ModuleBody';
import { trapTab } from '../components/trap-tab';

/**
 * The frame every quest-editor panel opens in: a centred modal over a dimmed backdrop, with a title,
 * an optional description, a close button and scrolling content. Edits save as they are made, so a
 * click on the backdrop closes it like Escape or the close button. Focus moves in when it opens and
 * goes back to whatever opened it when it closes.
 */
export function PanelFrame({
  title,
  description,
  onClose,
  children,
  footer,
}: {
  title: string;
  description?: string;
  onClose(): void;
  children: ReactNode;
  /** A bar under the scrolling content that stays in view, for the modal's own buttons. */
  footer?: ReactNode;
}): React.JSX.Element {
  const dialog = useRef<HTMLDivElement | null>(null);
  /** Only a click that also started on the backdrop closes it: a text selection dragged out must not. */
  const pressedBackdrop = useRef(false);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const self = dialog.current;
    self?.focus();
    return () => {
      if (opener?.isConnected) {
        opener.focus();
        return;
      }
      // What opened it is gone (a deleted row): focus the modal underneath, if one is still open.
      const below = [...document.querySelectorAll<HTMLElement>('.module-panel')].filter((p) => p !== self).at(-1);
      below?.focus();
    };
  }, []);

  return (
    <div
      className="module-modal"
      onMouseDown={(e) => {
        pressedBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (pressedBackdrop.current && e.target === e.currentTarget) onClose();
        pressedBackdrop.current = false;
      }}
    >
      <div ref={dialog} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className="module-panel" onKeyDown={(e) => trapTab(e, dialog.current)}>
        <div className="module-panel__head">
          <div>
            <h2 className="module-panel__title">{title}</h2>
            {description && <p className="module-panel__description">{description}</p>}
          </div>
          <button type="button" className="module-panel__close" aria-label="Close panel" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="module-panel__body">{children}</div>
        {footer && <div className="module-panel__foot--sticky">{footer}</div>}
      </div>
    </div>
  );
}

/** One module's panel: its issues, its body, and for an optional module a way to remove it. */
export function ModulePanel({
  id,
  issues,
  onClose,
  onRemove,
  ...body
}: ModuleBodyProps & { id: ModuleId; issues: readonly Issue[]; onClose(): void; onRemove(): void }): React.JSX.Element {
  const def = moduleById(id);
  function remove(): void {
    if (window.confirm(`Remove ${def.label}? Its settings are cleared.`)) onRemove();
  }
  return (
    <PanelFrame title={def.label} description={def.description} onClose={onClose}>
      {issues.length > 0 && (
        <ul className="module-panel__issues">
          {issues.map((issue, i) => (
            <li key={i} className={`module-panel__issue module-panel__issue--${issue.severity}`}>
              {issue.message}
            </li>
          ))}
        </ul>
      )}
      <ModuleBody id={id} {...body} />
      {def.kind === 'optional' && def.id !== 'advanced' && (
        <div className="module-panel__foot">
          <button type="button" className="btn module-panel__remove" onClick={remove}>
            Remove module
          </button>
        </div>
      )}
    </PanelFrame>
  );
}

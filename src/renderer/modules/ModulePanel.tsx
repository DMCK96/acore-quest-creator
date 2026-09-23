import type { ReactNode } from 'react';
import type { Issue } from '@core/validate/validate';
import type { ModuleId } from '@core/modules/model';
import { moduleById } from '@core/modules/catalog';
import type { ModuleBodyProps } from './body-props';
import { ModuleBody } from './ModuleBody';

/** The docked side panel frame: a title, an optional description, a close button and content. */
export function PanelFrame({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  onClose(): void;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div role="dialog" aria-label={title} className="module-panel">
      <header className="module-panel__head">
        <div>
          <h2 className="module-panel__title">{title}</h2>
          {description && <p className="module-panel__description">{description}</p>}
        </div>
        <button type="button" className="module-panel__close" aria-label="Close panel" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="module-panel__body">{children}</div>
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
      {def.kind === 'optional' && (
        <div className="module-panel__foot">
          <button type="button" className="btn module-panel__remove" onClick={remove}>
            Remove module
          </button>
        </div>
      )}
    </PanelFrame>
  );
}

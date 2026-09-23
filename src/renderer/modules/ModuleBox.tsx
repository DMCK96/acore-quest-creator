import type { ModuleDef, Values } from '@core/modules/model';
import { isModulePresent } from '@core/modules/catalog';
import type { NameBook } from '@core/links/component';

export interface ModuleBoxProps {
  def: ModuleDef;
  values: Values;
  names: NameBook;
  severity: 'error' | 'warning' | null;
  selected: boolean;
  onOpen(): void;
}

/** One module in the flow: its name and a line per thing set up in it, dashed while still empty. */
export function ModuleBox({ def, values, names, severity, selected, onOpen }: ModuleBoxProps): React.JSX.Element {
  const lines = def.summary(values, names);
  const empty = !isModulePresent(def.id, values);
  const classes = ['module-box', empty && 'module-box--empty', selected && 'module-box--selected', severity && `module-box--${severity}`]
    .filter(Boolean)
    .join(' ');
  return (
    <li className="module-flow__item">
      <button type="button" className={classes} data-module={def.id} aria-pressed={selected} onClick={onOpen}>
        <span className="module-box__label">
          {def.label}
          {severity && <span className={`module-box__dot module-box__dot--${severity}`} aria-label={severity} />}
        </span>
        {lines.length === 0 ? (
          <span className="module-box__line module-box__line--muted">Not set up yet</span>
        ) : (
          lines.slice(0, 6).map((line, i) => (
            <span key={i} className="module-box__line">
              {line}
            </span>
          ))
        )}
        {lines.length > 6 && <span className="module-box__line module-box__line--muted">{`+${lines.length - 6} more`}</span>}
      </button>
    </li>
  );
}

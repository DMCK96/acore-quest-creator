import type { ModuleId } from '@core/modules/model';
import { moduleById } from '@core/modules/catalog';
import type { AppStore } from '../state/app-store';
import { FieldSetting } from '../modules/FieldSetting';
import { ExportBar } from './ExportBar';

export interface ReadinessChip {
  id: ModuleId;
  severity: 'error' | 'warning';
}

/** Title, ID and the basics every quest has, the readiness chips, and Changes and Export. */
export function QuestHeader({ store, chips }: { store: AppStore; chips: readonly ReadinessChip[] }): React.JSX.Element | null {
  const open = store((s) => s.open);
  const setValue = store((s) => s.setValue);
  const setOpenPanel = store((s) => s.setOpenPanel);
  if (!open) return null;

  const { aggregate } = open;
  const titleValue = aggregate.values['quest_template.LogTitle'];
  const title = typeof titleValue === 'string' ? titleValue : '';

  return (
    <header className="quest-header">
      <div className="quest-header__title-row">
        <label htmlFor="quest-title" className="quest-header__title-label">
          Quest title
        </label>
        <input
          id="quest-title"
          className="quest-header__title"
          value={title}
          placeholder="Untitled quest"
          onChange={(e) => setValue('quest_template.LogTitle', e.target.value)}
        />
        <span className="quest-header__id">{`#${open.questId}`}</span>
        {aggregate.isNew && <span className="quest-header__new">NEW</span>}
      </div>
      <div className="quest-header__basics">
        <FieldSetting fieldId="quest_template.QuestLevel" label="Level" aggregate={aggregate} onChange={setValue} />
        <FieldSetting fieldId="quest_template.MinLevel" label="Min level" aggregate={aggregate} onChange={setValue} />
        <FieldSetting fieldId="quest_template.QuestSortID" label="Zone or category" aggregate={aggregate} onChange={setValue} />
      </div>
      <div className="quest-header__bar">
        <div className="quest-header__chips">
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              className={`quest-chip quest-chip--${chip.severity}`}
              onClick={() => setOpenPanel(chip.id)}
            >
              {`${moduleById(chip.id).label}: ${chip.severity}`}
            </button>
          ))}
        </div>
        <div className="quest-header__actions">
          <button type="button" className="btn" onClick={() => setOpenPanel('changes')}>
            Changes
          </button>
          <ExportBar store={store} />
        </div>
      </div>
    </header>
  );
}

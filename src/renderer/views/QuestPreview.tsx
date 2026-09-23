import { useEffect } from 'react';
import { moduleById, presentModules } from '@core/modules/catalog';
import type { AppStore } from '../state/app-store';
import { useNameBook } from '../state/names';
import { QUEST_SORTS } from '../controls/game-data';
import './QuestPreview.css';

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A negative sort is a quest-log category; a positive one is a zone ID. */
function sortName(sort: number): string | undefined {
  if (sort < 0) return QUEST_SORTS.find((s) => s.value === -sort)?.label;
  if (sort > 0) return `Zone #${sort}`;
  return undefined;
}

/**
 * The drawer beside the chain canvas when a quest is selected: what the quest is and what each of
 * its modules holds, read-only. Editing happens in the flow view, one click away.
 */
export function QuestPreview({ store }: { store: AppStore }): React.JSX.Element | null {
  const open = store((s) => s.open);
  const issues = store((s) => s.issues);
  const editQuest = store((s) => s.editQuest);
  const closeEditor = store((s) => s.closeEditor);
  const removeNode = store((s) => s.removeNode);
  const names = useNameBook();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') void closeEditor();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [closeEditor]);

  if (!open) return null;

  const values = open.aggregate.values;
  const title = typeof values['quest_template.LogTitle'] === 'string' && values['quest_template.LogTitle'] !== ''
    ? values['quest_template.LogTitle']
    : '(untitled quest)';
  const level = Number(values['quest_template.QuestLevel'] ?? 0);
  const sort = sortName(Number(values['quest_template.QuestSortID'] ?? 0));
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.length - errors;

  const remove = async (): Promise<void> => {
    await removeNode(open.questId);
    await closeEditor();
  };

  return (
    <aside role="complementary" aria-label="Quest preview" className="quest-preview">
      <header className="quest-preview__head">
        <h2 className="quest-preview__title">{title}</h2>
        <p className="quest-preview__meta">
          <span>{`#${open.questId}`}</span>
          <span>{level === -1 ? 'Scales with the player' : `Level ${level}`}</span>
          {sort && <span>{sort}</span>}
        </p>
        {(errors > 0 || warnings > 0) && (
          <p className="quest-preview__issues">
            {errors > 0 && <span className="quest-preview__errors">{plural(errors, 'error')}</span>}
            {warnings > 0 && <span className="quest-preview__warnings">{plural(warnings, 'warning')}</span>}
          </p>
        )}
      </header>
      <div className="quest-preview__body">
        {presentModules(values, []).map((id) => {
          const def = moduleById(id);
          const lines = def.summary(values, names);
          return (
            <section key={id} className="quest-preview__module">
              <h3 className="quest-preview__module-title">{def.label}</h3>
              {lines.length === 0 ? (
                <p className="quest-preview__line quest-preview__line--muted">Not set up yet</p>
              ) : (
                lines.map((line, i) => (
                  <p key={i} className="quest-preview__line">
                    {line}
                  </p>
                ))
              )}
            </section>
          );
        })}
      </div>
      <footer className="quest-preview__actions">
        <button type="button" className="btn quest-preview__edit" onClick={editQuest}>
          Edit quest
        </button>
        <button type="button" className="btn" onClick={() => void remove()}>
          Remove from canvas
        </button>
        <button type="button" className="btn" onClick={() => void closeEditor()}>
          Close preview
        </button>
      </footer>
    </aside>
  );
}

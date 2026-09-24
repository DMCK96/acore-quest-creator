import { useId, useState } from 'react';
import './editor.css';

export interface EditorTab {
  id: string;
  label: string;
  render(): React.ReactNode;
}

/**
 * A row of tabs over one panel, for the NPC and object editors. Controlled when `tab` is given (so
 * the editor can come back on the same tab), otherwise it keeps its own. A tab that is no longer
 * offered falls back to the first.
 */
export function EditorTabs({ label, tabs, tab, onTab }: { label: string; tabs: EditorTab[]; tab?: string; onTab?(id: string): void }): React.JSX.Element {
  const base = useId();
  const [own, setOwn] = useState(tabs[0]?.id ?? '');
  const wanted = tab ?? own;
  const shown = tabs.find((t) => t.id === wanted) ?? tabs[0];
  const choose = (id: string): void => {
    setOwn(id);
    onTab?.(id);
  };
  return (
    <div className="editor-tabs">
      <div role="tablist" aria-label={label} className="editor-tabs__list">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" id={`${base}-${t.id}`} aria-selected={t.id === shown?.id}
            aria-controls={`${base}-${t.id}-panel`} className={`editor-tabs__tab${t.id === shown?.id ? ' editor-tabs__tab--on' : ''}`}
            onClick={() => choose(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {shown && (
        <div role="tabpanel" id={`${base}-${shown.id}-panel`} aria-labelledby={`${base}-${shown.id}`} className="editor-tabs__panel">
          {shown.render()}
        </div>
      )}
    </div>
  );
}

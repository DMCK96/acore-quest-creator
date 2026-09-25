import { useEffect, useRef, useState } from 'react';
import type { AppStore } from '../state/app-store';
import './QuestPicker.css';

const SEARCH_DEBOUNCE_MS = 250;

const unmodelledNotice = (count: number): string =>
  `${count} column${count === 1 ? '' : 's'} in your database ${count === 1 ? 'is' : 'are'} not modelled by this tool and will be preserved unchanged.`;

/** A forbidden table would otherwise read as "this fork does not have it" and import partially. */
const forbiddenNotice = (tables: string[]): string =>
  `${tables.join(', ')} exist${tables.length === 1 ? 's' : ''} in your database but this user may not read ` +
  `${tables.length === 1 ? 'it' : 'them'}. Quests will import without those rows until the user is granted SELECT on ${tables.length === 1 ? 'it' : 'them'}.`;

/** A search box over a scrolling list of matching quests. */
export function QuestPicker({
  store,
  onSelect,
  showNewQuestButton = true,
  autoFocus = false,
}: {
  store: AppStore;
  /** Overrides the default "open this quest" behaviour, e.g. so a host dialog can place it. */
  onSelect?: (id: number) => void;
  /** False when a host (like `AddExistingDialog`) provides its own "new quest" entry point. */
  showNewQuestButton?: boolean;
  /** Focuses the search box on mount, as a dialog opened for it wants. */
  autoFocus?: boolean;
}): React.JSX.Element {
  const summary = store((s) => s.summary);
  const results = store((s) => s.results);
  const error = store((s) => s.error);
  const search = store((s) => s.search);
  const openQuest = store((s) => s.openQuest);
  const newQuest = store((s) => s.newQuest);

  const selectResult = (id: number): void => {
    if (onSelect) onSelect(id);
    else void openQuest(id);
  };

  const [text, setText] = useState('');
  // The text the results on screen answer; '' until a search has come back.
  const [searched, setSearched] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const onChange = (value: string): void => {
    setText(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void search(value).then(() => setSearched(value.trim()));
    }, SEARCH_DEBOUNCE_MS);
  };

  const unregisteredCount = summary?.drift.unregistered.length ?? 0;
  const forbidden = summary?.drift.forbiddenTables ?? [];
  const typed = text.trim();
  const first = results[0];

  return (
    <div className="quest-picker">
      {error && (
        <div className="quest-picker__error" role="alert">
          {error}
        </div>
      )}
      {forbidden.length > 0 && <p className="quest-picker__notice">{forbiddenNotice(forbidden)}</p>}
      {unregisteredCount > 0 && <p className="quest-picker__notice">{unmodelledNotice(unregisteredCount)}</p>}
      <input
        role="searchbox"
        aria-label="Search quests"
        className="quest-picker__search"
        value={text}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // Enter takes the top result, once the results answer what was typed.
          if (e.key === 'Enter' && first && searched === typed) selectResult(first.id);
        }}
        placeholder="Search by quest name or ID"
      />
      {results.length > 0 ? (
        <ul className="quest-picker__results">
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="quest-picker__result"
                aria-label={`${r.title} (${r.id}, level ${r.level})`}
                onClick={() => selectResult(r.id)}
              >
                <span className="quest-picker__title">{r.title || '(untitled quest)'}</span>
                <span className="quest-picker__meta">
                  #{r.id} · level {r.level}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="quest-picker__empty">
          {typed !== '' && searched === typed ? `No quests match “${typed}”.` : 'Type a quest name or ID to search.'}
        </p>
      )}
      {showNewQuestButton && (
        <button type="button" className="btn" onClick={() => void newQuest()}>
          New quest
        </button>
      )}
    </div>
  );
}

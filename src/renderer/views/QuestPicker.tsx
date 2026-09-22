import { useEffect, useRef, useState } from 'react';
import type { AppStore } from '../state/app-store';

const SEARCH_DEBOUNCE_MS = 250;

const unmodelledNotice = (count: number): string =>
  `${count} column${count === 1 ? '' : 's'} in your database ${count === 1 ? 'is' : 'are'} not modelled by this tool and will be preserved unchanged.`;

/** A forbidden table would otherwise read as "this fork does not have it" and import partially. */
const forbiddenNotice = (tables: string[]): string =>
  `${tables.join(', ')} exist${tables.length === 1 ? 's' : ''} in your database but this user may not read ` +
  `${tables.length === 1 ? 'it' : 'them'}. Quests will import without those rows until the user is granted SELECT on ${tables.length === 1 ? 'it' : 'them'}.`;

export function QuestPicker({
  store,
  onSelect,
  showNewQuestButton = true,
}: {
  store: AppStore;
  /** Overrides the default "open this quest" behaviour, e.g. so a host dialog can place it. */
  onSelect?: (id: number) => void;
  /** False when a host (like `AddExistingDialog`) provides its own "new quest" entry point. */
  showNewQuestButton?: boolean;
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
      void search(value);
    }, SEARCH_DEBOUNCE_MS);
  };

  const unregisteredCount = summary?.drift.unregistered.length ?? 0;
  const forbidden = summary?.drift.forbiddenTables ?? [];

  return (
    <div>
      <h1>Find a quest</h1>
      {error && <div role="alert">{error}</div>}
      {forbidden.length > 0 && <p>{forbiddenNotice(forbidden)}</p>}
      {unregisteredCount > 0 && <p>{unmodelledNotice(unregisteredCount)}</p>}
      <input role="searchbox" value={text} onChange={(e) => onChange(e.target.value)} placeholder="Search quests" />
      <ul>
        {results.map((r) => (
          <li key={r.id}>
            <button type="button" onClick={() => selectResult(r.id)}>
              {r.title} ({r.id}, level {r.level})
            </button>
          </li>
        ))}
      </ul>
      {showNewQuestButton && (
        <button type="button" onClick={() => void newQuest()}>
          New quest
        </button>
      )}
    </div>
  );
}

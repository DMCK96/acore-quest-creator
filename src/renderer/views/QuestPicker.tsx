import { useEffect, useRef, useState } from 'react';
import type { AppStore } from '../state/app-store';

const SEARCH_DEBOUNCE_MS = 250;

const unmodelledNotice = (count: number): string =>
  `${count} column${count === 1 ? '' : 's'} in your database ${count === 1 ? 'is' : 'are'} not modelled by this tool and will be preserved unchanged.`;

export function QuestPicker({ store }: { store: AppStore }): React.JSX.Element {
  const summary = store((s) => s.summary);
  const results = store((s) => s.results);
  const error = store((s) => s.error);
  const search = store((s) => s.search);
  const openQuest = store((s) => s.openQuest);
  const newQuest = store((s) => s.newQuest);

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

  return (
    <div>
      <h1>Find a quest</h1>
      {error && <div role="alert">{error}</div>}
      {unregisteredCount > 0 && <p>{unmodelledNotice(unregisteredCount)}</p>}
      <input role="searchbox" value={text} onChange={(e) => onChange(e.target.value)} placeholder="Search quests" />
      <ul>
        {results.map((r) => (
          <li key={r.id}>
            <button type="button" onClick={() => void openQuest(r.id)}>
              {r.title} ({r.id}, level {r.level})
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => void newQuest()}>
        New quest
      </button>
    </div>
  );
}

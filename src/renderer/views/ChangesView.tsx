import { useEffect } from 'react';
import type { Difference } from '@core/roundtrip/compare';
import type { RawValue } from '@core/db/types';
import type { AppStore } from '../state/app-store';

/** SQL `NULL` reads as `NULL`, the empty string as `(empty)`, everything else verbatim. */
function formatCell(value: RawValue | undefined): string {
  if (value === null) return 'NULL';
  if (value === '') return '(empty)';
  return String(value);
}

function groupByTable(differences: Difference[]): [string, Difference[]][] {
  const byTable = new Map<string, Difference[]>();
  for (const d of differences) {
    const bucket = byTable.get(d.table);
    if (bucket) bucket.push(d);
    else byTable.set(d.table, [d]);
  }
  return [...byTable.entries()];
}

/**
 * A preview of what an export would write: every difference between the live import snapshot and
 * the current draft, grouped by table. Reloads whenever this tab is opened, so it reflects the
 * latest edits without the user needing to export first.
 */
export function ChangesView({ store }: { store: AppStore }): React.JSX.Element | null {
  const preview = store((s) => s.preview);
  const loadPreview = store((s) => s.loadPreview);

  useEffect(() => {
    void loadPreview();
    // Reload each time the tab mounts (i.e. each time it becomes active).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (preview === null) return null;
  if (preview.length === 0) return <p>No changes since this quest was loaded.</p>;

  return (
    <div>
      {groupByTable(preview).map(([table, diffs]) => (
        <div key={table}>
          <h3>{table}</h3>
          <ul>
            {diffs.map((d, i) => (
              <li key={i}>
                {d.column === null ? (
                  <span>
                    {d.before === undefined ? 'New row' : 'Removed row'} ({d.key})
                  </span>
                ) : (
                  <span>
                    <span>{d.key}</span> <span>{d.column}</span>: <span>{formatCell(d.before)}</span>{' '}
                    &rarr; <span>{formatCell(d.after)}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

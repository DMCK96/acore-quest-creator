import type { UnmodelledColumn } from '@core/import/unmodelled';

/**
 * Read-only listing of database columns the registry does not model. They are carried through
 * untouched by import/export, so this tab is purely informational.
 */
export function UnmodelledPanel({ unmodelled }: { unmodelled: UnmodelledColumn[] }): React.JSX.Element {
  if (unmodelled.length === 0) {
    return <p>Every column in your database is covered by this tool.</p>;
  }

  return (
    <div>
      <p>
        These columns exist in your database but this tool does not edit them. They are kept
        unchanged.
      </p>
      <table>
        <tbody>
          {unmodelled.map((u) =>
            u.values.map((v, i) => (
              <tr key={`${u.table}.${u.column}-${i}`}>
                <td>
                  {u.table}.{u.column}
                </td>
                <td>{v.key}</td>
                <td>{v.value}</td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </div>
  );
}

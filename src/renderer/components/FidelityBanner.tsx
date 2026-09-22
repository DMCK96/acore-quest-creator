import type { FidelityReport } from '@core/roundtrip/verify';

const show = (value: string | null | undefined): string =>
  value === undefined ? '(absent)' : value === null ? 'NULL' : value;

export function FidelityBanner({ fidelity }: { fidelity: FidelityReport }): React.JSX.Element | null {
  if (fidelity.ok) return null;
  return (
    <div role="alert">
      <p>Unsafe to export: this quest did not survive the round-trip check.</p>
      <ul>
        {fidelity.differences.map((d, i) => (
          <li key={i}>
            {/* A whole-row difference has no cell to show; `kind` is what says what happened. */}
            {d.column === null && d.kind !== undefined ? (
              <>
                {d.table} {d.key}: row {d.kind}
              </>
            ) : (
              <>
                {d.table} {d.key} {d.column ?? '(row)'}: {show(d.before)} &rarr; {show(d.after)}
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

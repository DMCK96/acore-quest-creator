/**
 * A select over numbered names (item classes, stat types, …). A value the list does not name is
 * still offered, as its number, so an imported item never shows a different value than it has.
 */
export function NumberSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: number;
  options: readonly (readonly [number, string])[];
  onChange(n: number): void;
}): React.JSX.Element {
  const listed = options.some(([v]) => v === value);
  return (
    <label className="scene-field">
      <span>{label}</span>
      <select value={String(value)} onChange={(e) => onChange(Number(e.target.value))}>
        {!listed && <option value={String(value)}>{value}</option>}
        {options.map(([v, text]) => (
          <option key={v} value={String(v)}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

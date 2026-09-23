export interface NamedSelectProps {
  id: string;
  label: string;
  value: number;
  onChange(id: number): void;
  disabled?: boolean;
}

/**
 * A labelled dropdown over a fixed list of named IDs. A stored ID the list does not know is kept,
 * shown as `#ID`, so an imported or custom value is never silently replaced.
 */
export function NamedSelect({
  id,
  label,
  value,
  onChange,
  disabled,
  options,
}: NamedSelectProps & { options: readonly { id: number; name: string }[] }): React.JSX.Element {
  const known = value === 0 || options.some((o) => o.id === value);
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))}>
        <option value={0}>—</option>
        {!known && <option value={value}>{`#${value}`}</option>}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </div>
  );
}

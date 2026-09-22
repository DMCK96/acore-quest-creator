import type { ListFieldDef, ListValue, ScalarValue } from '@core/registry/types';
import { defaultForType } from './defaults';
import { resolveControl } from './resolve';

export interface ListEditorProps {
  id?: string;
  label?: string;
  def: ListFieldDef;
  value: ListValue;
  onChange(next: ListValue): void;
  disabled?: boolean;
  readOnlyReason?: string;
}

/** Renders one row per list entry using each member's resolved control, "Add" capped at `def.slots`. */
export function ListEditor(props: ListEditorProps): React.JSX.Element {
  const { def, value, onChange, disabled, readOnlyReason } = props;
  const label = props.label ?? def.label;
  const baseId = props.id ?? def.id;
  const atCap = value.length >= def.slots;

  function updateRow(index: number, member: string, next: ScalarValue): void {
    onChange(value.map((row, i) => (i === index ? { ...row, [member]: next } : row)));
  }

  function addRow(): void {
    const row: Record<string, ScalarValue> = {};
    for (const m of def.members) row[m.name] = defaultForType(m.type);
    onChange([...value, row]);
  }

  function removeRow(index: number): void {
    onChange(value.filter((_, i) => i !== index));
  }

  return (
    <fieldset>
      <legend>{label}</legend>
      {def.help && <p>{def.help}</p>}
      {value.map((row, index) => (
        <div key={index}>
          {def.members.map((m) => {
            const Control = resolveControl(m);
            return (
              <Control
                key={m.name}
                id={`${baseId}-${index}-${m.name}`}
                label={m.label}
                value={row[m.name]}
                disabled={disabled}
                onChange={(next: ScalarValue) => updateRow(index, m.name, next)}
                def={m}
                type={m.type}
              />
            );
          })}
          <button type="button" disabled={disabled} onClick={() => removeRow(index)}>
            {`Remove ${label} ${index + 1}`}
          </button>
        </div>
      ))}
      <button type="button" disabled={disabled || atCap} onClick={addRow}>
        Add
      </button>
      {atCap && <p>{`At most ${def.slots} entries.`}</p>}
      {readOnlyReason && <p role="alert">{readOnlyReason}</p>}
    </fieldset>
  );
}

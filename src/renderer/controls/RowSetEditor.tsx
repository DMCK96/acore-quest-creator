import type { RowSetFieldDef, RowSetValue, ScalarValue } from '@core/registry/types';
import { defaultForType } from './defaults';
import { resolveControl } from './resolve';

export interface RowSetEditorProps {
  id?: string;
  label?: string;
  def: RowSetFieldDef;
  value: RowSetValue;
  onChange(next: RowSetValue): void;
  disabled?: boolean;
  readOnlyReason?: string;
  /**
   * Builds the row a click on "Add" appends, given the rows already present. Lets a specific group
   * (map markers auto-numbering their id, points auto-numbering their index) compute a row from the
   * existing ones instead of getting the all-zero default for every column.
   */
  newRow?: (rows: RowSetValue) => Record<string, ScalarValue>;
}

/** Same pattern as `ListEditor`, for row-set fields (`def.columns`); no slot limit. */
export function RowSetEditor(props: RowSetEditorProps): React.JSX.Element {
  const { def, value, onChange, disabled, readOnlyReason, newRow } = props;
  const label = props.label ?? def.label;
  const baseId = props.id ?? def.id;

  function updateCell(index: number, column: string, next: ScalarValue): void {
    onChange(value.map((row, i) => (i === index ? { ...row, [column]: next } : row)));
  }

  function addRow(): void {
    if (newRow) {
      onChange([...value, newRow(value)]);
      return;
    }
    const row: Record<string, ScalarValue> = {};
    for (const c of def.columns) row[c.name] = defaultForType(c.type);
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
          {def.columns.map((c) => {
            const Control = resolveControl(c);
            return (
              <Control
                key={c.name}
                id={`${baseId}-${index}-${c.name}`}
                label={c.label}
                value={row[c.name]}
                disabled={disabled}
                onChange={(next: ScalarValue) => updateCell(index, c.name, next)}
                def={c}
                type={c.type}
              />
            );
          })}
          <button type="button" disabled={disabled} onClick={() => removeRow(index)}>
            {`Remove ${label} ${index + 1}`}
          </button>
        </div>
      ))}
      <button type="button" disabled={disabled} onClick={addRow}>
        Add
      </button>
      {readOnlyReason && <p role="alert">{readOnlyReason}</p>}
    </fieldset>
  );
}

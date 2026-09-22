import type { RowSetFieldDef, RowSetValue, ScalarValue } from '@core/registry/types';
import { defaultForType } from './defaults';
import { resolveControl } from './resolve';
import type { ControlProps } from './types';

function toNum(value: ScalarValue | undefined): number {
  return typeof value === 'number' ? value : Number(value ?? 0) || 0;
}

/** `quest_poi`'s next row: the highest existing `id` plus one (1 if the table is empty). */
function nextPoiRow(def: RowSetFieldDef, rows: RowSetValue): Record<string, ScalarValue> {
  const maxId = rows.reduce((m, r) => Math.max(m, toNum(r.id)), 0);
  const row: Record<string, ScalarValue> = {};
  for (const c of def.columns) row[c.name] = defaultForType(c.type);
  row.id = maxId + 1;
  return row;
}

/**
 * `quest_poi_points`'s next row: the highest existing marker id (`Idx1`, 1 if none exist yet), and
 * within that marker the highest existing `Idx2` plus one (0 if that marker has no points yet).
 */
function nextPointRow(def: RowSetFieldDef, rows: RowSetValue): Record<string, ScalarValue> {
  const idx1 = rows.length === 0 ? 1 : rows.reduce((m, r) => Math.max(m, toNum(r.Idx1)), 0);
  const idx2 = rows.filter((r) => toNum(r.Idx1) === idx1).reduce((m, r) => Math.max(m, toNum(r.Idx2) + 1), 0);
  const row: Record<string, ScalarValue> = {};
  for (const c of def.columns) row[c.name] = defaultForType(c.type);
  row.Idx1 = idx1;
  row.Idx2 = idx2;
  return row;
}

const ADD_LABEL: Record<string, string> = {
  quest_poi: 'Add POI',
  quest_poi_points: 'Add point',
};

/**
 * `quest_poi` and `quest_poi_points`, both resolved to this control (`def.control === 'poi'`).
 * Renders like `RowSetEditor` but the add button auto-numbers the new row (`nextPoiRow` /
 * `nextPointRow`) instead of defaulting every column to zero, and is labelled for the table it adds
 * to rather than the generic "Add".
 */
export function PoiControl(props: ControlProps<RowSetValue> & { def: RowSetFieldDef }): React.JSX.Element {
  const { def, value, onChange, disabled, readOnlyReason } = props;
  const rows = value ?? [];
  const addLabel = ADD_LABEL[def.id] ?? 'Add';
  const makeNextRow = def.id === 'quest_poi' ? nextPoiRow : nextPointRow;

  function updateCell(index: number, column: string, next: ScalarValue): void {
    onChange(rows.map((row, i) => (i === index ? { ...row, [column]: next } : row)));
  }

  function removeRow(index: number): void {
    onChange(rows.filter((_, i) => i !== index));
  }

  function addRow(): void {
    onChange([...rows, makeNextRow(def, rows)]);
  }

  return (
    <fieldset>
      <legend>{def.label}</legend>
      {def.help && <p>{def.help}</p>}
      {rows.map((row, index) => (
        <div key={index}>
          {def.columns.map((c) => {
            const Control = resolveControl(c);
            return (
              <Control
                key={c.name}
                id={`${def.id}-${index}-${c.name}`}
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
            {`Remove ${def.label} ${index + 1}`}
          </button>
        </div>
      ))}
      <button type="button" disabled={disabled} onClick={addRow}>
        {addLabel}
      </button>
      {readOnlyReason && <p role="alert">{readOnlyReason}</p>}
    </fieldset>
  );
}

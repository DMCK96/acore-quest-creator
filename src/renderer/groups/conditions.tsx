import type { RowSetFieldDef, RowSetValue, ScalarValue } from '@core/registry/types';
import { resolveControl } from '../controls/resolve';
import type { ControlProps } from '../controls/types';

/** A quest-state condition type this describes in plain language, keyed by `ConditionTypeOrReference`. */
const QUEST_STATE_SENTENCES: Record<number, { positive: string; negative: string }> = {
  8: { positive: 'The player has been rewarded quest {q}', negative: 'The player has NOT been rewarded quest {q}' },
  9: { positive: 'The player currently has quest {q}', negative: 'The player does not currently have quest {q}' },
  14: { positive: 'The player has never taken quest {q}', negative: 'The player has taken quest {q}' },
  28: {
    positive: 'The player has completed quest {q} but not turned it in',
    negative: 'The player has NOT completed quest {q} without turning it in',
  },
};

function toNumber(value: ScalarValue | undefined): number {
  return typeof value === 'number' ? value : Number(value ?? 0) || 0;
}

/**
 * Renders one `conditions` row as a plain-language sentence, for the availability group's
 * condition list. Only the quest-state condition types (8, 9, 14, 28) get a tailored sentence;
 * every other type (including malformed/unknown input) falls back to a generic description that
 * never throws.
 */
export function describeCondition(row: Record<string, ScalarValue>): string {
  const type = toNumber(row.ConditionTypeOrReference);
  const negative = toNumber(row.NegativeCondition) === 1;
  const sentence = QUEST_STATE_SENTENCES[type];
  if (sentence) {
    const questId = toNumber(row.ConditionValue1);
    return (negative ? sentence.negative : sentence.positive).replace('{q}', String(questId));
  }
  const v1 = toNumber(row.ConditionValue1);
  const v2 = toNumber(row.ConditionValue2);
  const v3 = toNumber(row.ConditionValue3);
  return `Condition type ${type} (values ${v1}, ${v2}, ${v3})`;
}

/** A new condition row: type "Quest rewarded" (8), every other column zero/empty/null. */
function newConditionRow(def: RowSetFieldDef): Record<string, ScalarValue> {
  const row: Record<string, ScalarValue> = {};
  for (const c of def.columns) row[c.name] = c.type.kind === 'string' || c.type.kind === 'text' ? '' : 0;
  row.ConditionTypeOrReference = 8;
  row.Comment = null;
  return row;
}

/**
 * The `conditions` rowset: `describeCondition`'s sentence above each row's raw columns, still
 * editable underneath, and an add button that defaults a new row to the "Quest rewarded" type.
 * Resolved for the `conditions` field via `control: 'conditions'`.
 */
export function ConditionsControl(props: ControlProps<RowSetValue> & { def: RowSetFieldDef }): React.JSX.Element {
  const { def, value, onChange, disabled, readOnlyReason } = props;
  const rows = value ?? [];

  function updateCell(index: number, column: string, next: ScalarValue): void {
    onChange(rows.map((row, i) => (i === index ? { ...row, [column]: next } : row)));
  }

  function removeRow(index: number): void {
    onChange(rows.filter((_, i) => i !== index));
  }

  function addRow(): void {
    onChange([...rows, newConditionRow(def)]);
  }

  return (
    <fieldset>
      <legend>{def.label}</legend>
      {def.help && <p>{def.help}</p>}
      {rows.map((row, index) => (
        <div key={index}>
          <p>{describeCondition(row)}</p>
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
        Add
      </button>
      {readOnlyReason && <p role="alert">{readOnlyReason}</p>}
    </fieldset>
  );
}

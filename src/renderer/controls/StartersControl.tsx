import type { RefKind } from '@core/db/types';
import type { RowSetFieldDef, RowSetValue, ScalarValue } from '@core/registry/types';
import { useName } from '../state/names';
import type { ControlProps } from './types';

/** What one starter/ender rowset table shows as its group name and how its id is looked up. */
interface TableInfo {
  groupLabel: string;
  /** A one-word noun for this row's per-row label/button text, so only the legend names the group. */
  rowNoun: string;
  kind: 'creature' | 'gameobject' | 'areatrigger';
}

const TABLE_INFO: Record<string, TableInfo> = {
  creature_queststarter: { groupLabel: 'Offered by creatures', rowNoun: 'Creature', kind: 'creature' },
  gameobject_queststarter: { groupLabel: 'Offered by objects', rowNoun: 'Object', kind: 'gameobject' },
  creature_questender: { groupLabel: 'Turned in to creatures', rowNoun: 'Creature', kind: 'creature' },
  gameobject_questender: { groupLabel: 'Turned in to objects', rowNoun: 'Object', kind: 'gameobject' },
  areatrigger_involvedrelation: { groupLabel: 'Completed by area triggers', rowNoun: 'Trigger', kind: 'areatrigger' },
};

/** One row's id, named through `useName` when the world DB can resolve it. */
function RowName({ kind, id }: { kind: TableInfo['kind']; id: number }): React.JSX.Element {
  if (kind === 'areatrigger') {
    return <span>{`Trigger ${id} (names are not stored in the world database)`}</span>;
  }
  const refKind: RefKind = kind;
  const { state, name } = useName(refKind, id);
  if (state === 'found' && name) return <span>{name}</span>;
  if (id === 0) return <span>{`New ${kind}`}</span>;
  return <span>{`${kind} ${id}`}</span>;
}

/**
 * Shared body for the starter/ender rowset controls: a `<fieldset>` named for the table (from
 * `TABLE_INFO`), a row per entry showing its resolved name and a remove button, and an add button
 * that appends `{ id: 0 }`. `StartersControl` and `EndersControl` both resolve to this: which table
 * a given instance edits comes from `def.id`, and every starter/ender table shares this shape.
 */
export function RowIdListControl(props: ControlProps<RowSetValue> & { def: RowSetFieldDef }): React.JSX.Element {
  const { def, value, onChange, disabled, readOnlyReason } = props;
  const info = TABLE_INFO[def.id] ?? { groupLabel: def.label, rowNoun: 'Entry', kind: 'creature' as const };
  const rows = value ?? [];

  function updateId(index: number, id: number): void {
    onChange(rows.map((row, i) => (i === index ? { ...row, id } : row)));
  }

  function removeRow(index: number): void {
    onChange(rows.filter((_, i) => i !== index));
  }

  function addRow(): void {
    const row: Record<string, ScalarValue> = { id: 0 };
    onChange([...rows, row]);
  }

  return (
    <fieldset>
      <legend>{info.groupLabel}</legend>
      {def.help && <p>{def.help}</p>}
      {rows.map((row, index) => {
        const id = typeof row.id === 'number' ? row.id : Number(row.id) || 0;
        return (
          <div key={index}>
            <label htmlFor={`${def.id}-${index}`}>{`${info.rowNoun} ${index + 1} ID`}</label>
            <input
              id={`${def.id}-${index}`}
              type="number"
              value={id}
              disabled={disabled}
              onChange={(e) => updateId(index, Number(e.target.value) || 0)}
            />
            <RowName kind={info.kind} id={id} />
            <button type="button" disabled={disabled} onClick={() => removeRow(index)}>
              {`Remove ${info.rowNoun} ${index + 1}`}
            </button>
          </div>
        );
      })}
      <button type="button" disabled={disabled} onClick={addRow}>
        Add
      </button>
      {readOnlyReason && <p role="alert">{readOnlyReason}</p>}
    </fieldset>
  );
}

export function StartersControl(props: ControlProps<RowSetValue> & { def: RowSetFieldDef }): React.JSX.Element {
  return <RowIdListControl {...props} />;
}

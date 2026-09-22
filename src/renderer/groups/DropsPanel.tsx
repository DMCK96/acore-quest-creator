import { useState } from 'react';
import type { RefKind } from '@core/db/types';
import { fieldsOfGroup } from '@core/registry';
import type { FieldValue, RowSetColumn, RowSetFieldDef, ScalarValue } from '@core/registry/types';
import { resolveControl } from '../controls/resolve';
import { useName } from '../state/names';
import { addDropSource, listDropSources, removeDropSource, type DropRow, type DropSource, type Values } from './drops-model';

export interface DropsPanelProps {
  itemId: number;
  values: Values;
  sharedItems: Record<string, number[]>;
  onChange(fieldId: string, value: FieldValue): void;
}

const TABLES_OF: Record<DropSource['kind'], readonly [string, string]> = {
  creature: ['creature_loot_template', 'creature_questitem'],
  gameobject: ['gameobject_loot_template', 'gameobject_questitem'],
};

/** The entry column of each kind's quest-item table, which is the only thing that differs. */
const ENTRY_COLUMN: Record<DropSource['kind'], string> = {
  creature: 'CreatureEntry',
  gameobject: 'GameObjectEntry',
};

/**
 * The columns that say *which* row this is: the source entry (set by "Source ID" when the source
 * is added, changed by removing and re-adding) and the item (this whole panel is about one item,
 * chosen in the objectives list). Every other column of both linked tables is editable in the
 * Advanced section below, so spec success criterion 4 — "every field ... reachable through a
 * curated control" — holds here too and nothing is editable only by hand-writing SQL.
 */
const IDENTITY_COLUMNS: ReadonlySet<string> = new Set(['Entry', 'CreatureEntry', 'GameObjectEntry', 'Item', 'ItemId']);

const linkedField = (table: string): RowSetFieldDef | undefined =>
  fieldsOfGroup('objectives').find((f) => f.shape === 'rowset' && f.table === table) as RowSetFieldDef | undefined;

/** The name for one existing drop source's row, resolved through `useName` like any other id. */
function SourceName({ kind, entry }: { kind: DropSource['kind']; entry: number }): React.JSX.Element {
  const refKind: RefKind = kind === 'creature' ? 'creature' : 'gameobject';
  const { state, name } = useName(refKind, entry);
  return <>{state === 'found' ? name : `${kind} ${entry}`}</>;
}

/** One column of one linked row, edited through whatever control the registry resolves for it. */
function ColumnControl({
  baseId,
  column,
  row,
  onCell,
}: {
  baseId: string;
  column: RowSetColumn;
  row: Record<string, ScalarValue>;
  onCell(column: string, next: ScalarValue): void;
}): React.JSX.Element {
  const Control = resolveControl(column);
  return (
    <Control
      id={`${baseId}-${column.name}`}
      label={column.label}
      value={row[column.name]}
      onChange={(next: ScalarValue) => onCell(column.name, next)}
      def={column}
      type={column.type}
    />
  );
}

/**
 * Edits where one required item drops from: the existing creature/gameobject sources for `itemId`,
 * with remove buttons, and a form to add another. Every add/remove calls `onChange` once per
 * touched linked rowset (the loot table and the quest-item table for that source's kind).
 *
 * The columns the "where does this drop" abstraction does not need — reference loot, loot mode,
 * group, comment, the quest-item slot and verified build — sit under a collapsed "Advanced" per
 * source, the same convention `GroupPanel` uses, rather than being unreachable.
 */
export function DropsPanel({ itemId, values, sharedItems, onChange }: DropsPanelProps): React.JSX.Element {
  const { state, name } = useName('item', itemId);
  const itemName = state === 'found' && name ? name : `item ${itemId}`;
  const sources = listDropSources(values, itemId);
  const shared = sharedItems[String(itemId)] ?? [];

  const [kind, setKind] = useState<DropSource['kind']>('creature');
  const [entry, setEntry] = useState('');
  const [chance, setChance] = useState('100');
  const [minCount, setMinCount] = useState('1');
  const [maxCount, setMaxCount] = useState('1');

  const baseId = `drops-${itemId}`;
  const heading = `Where ${itemName} comes from`;

  function apply(next: Values, sourceKind: DropSource['kind']): void {
    const [loot, questItem] = TABLES_OF[sourceKind];
    onChange(loot, next[loot]);
    onChange(questItem, next[questItem]);
  }

  function addSource(): void {
    const row: DropRow = {
      source: { kind, entry: Number(entry) || 0 },
      chance: Number(chance) || 0,
      minCount: Number(minCount) || 0,
      maxCount: Number(maxCount) || 0,
    };
    apply(addDropSource(values, itemId, row), kind);
  }

  function remove(source: DropSource): void {
    apply(removeDropSource(values, itemId, source), source.kind);
  }

  /** Replaces one cell of the loot or quest-item row backing `source`, leaving every other row be. */
  function setCell(source: DropSource, table: string, match: (r: Record<string, ScalarValue>) => boolean) {
    return (column: string, next: ScalarValue): void => {
      const rows = (values[table] as Record<string, ScalarValue>[] | undefined) ?? [];
      onChange(
        table,
        rows.map((r) => (match(r) ? { ...r, [column]: next } : r)),
      );
    };
  }

  function advanced(source: DropSource): React.JSX.Element | null {
    const [loot, questItem] = TABLES_OF[source.kind];
    const entryColumn = ENTRY_COLUMN[source.kind];
    const lootField = linkedField(loot);
    const questItemField = linkedField(questItem);
    const lootRows = (values[loot] as Record<string, ScalarValue>[] | undefined) ?? [];
    const questItemRows = (values[questItem] as Record<string, ScalarValue>[] | undefined) ?? [];
    const lootRow = lootRows.find((r) => r.Entry === source.entry && r.Item === itemId);
    const questItemRow = questItemRows.find((r) => r[entryColumn] === source.entry && r.ItemId === itemId);
    if (!lootField && !questItemField) return null;

    const id = `${baseId}-${source.kind}-${source.entry}`;
    return (
      <details>
        <summary>{`Advanced (${source.kind} ${source.entry})`}</summary>
        {lootField && lootRow && (
          <fieldset>
            <legend>{lootField.label}</legend>
            {lootField.columns
              .filter((c) => !IDENTITY_COLUMNS.has(c.name))
              .map((c) => (
                <ColumnControl
                  key={c.name}
                  baseId={`${id}-loot`}
                  column={c}
                  row={lootRow}
                  onCell={setCell(source, loot, (r) => r.Entry === source.entry && r.Item === itemId)}
                />
              ))}
          </fieldset>
        )}
        {questItemField && questItemRow && (
          <fieldset>
            <legend>{questItemField.label}</legend>
            {questItemField.columns
              .filter((c) => !IDENTITY_COLUMNS.has(c.name))
              .map((c) => (
                <ColumnControl
                  key={c.name}
                  baseId={`${id}-questitem`}
                  column={c}
                  row={questItemRow}
                  onCell={setCell(source, questItem, (r) => r[entryColumn] === source.entry && r.ItemId === itemId)}
                />
              ))}
          </fieldset>
        )}
      </details>
    );
  }

  return (
    <section role="region" aria-label={heading}>
      <h3>{heading}</h3>
      {shared.length > 0 && (
        <p>{`Also used by quest ${shared.join(', ')} — changing these drops affects those quests too.`}</p>
      )}
      <ul>
        {sources.map((s) => (
          <li key={`${s.source.kind}-${s.source.entry}`}>
            <SourceName kind={s.source.kind} entry={s.source.entry} />
            {` — ${s.chance}% chance, ${s.minCount}-${s.maxCount}`}
            <button type="button" onClick={() => remove(s.source)}>
              {`Remove source ${s.source.entry}`}
            </button>
            {advanced(s.source)}
          </li>
        ))}
      </ul>
      <div>
        <label htmlFor={`${baseId}-kind`}>Source type</label>
        <select
          id={`${baseId}-kind`}
          value={kind === 'creature' ? 'Creature' : 'Object'}
          onChange={(e) => setKind(e.target.value === 'Object' ? 'gameobject' : 'creature')}
        >
          <option value="Creature">Creature</option>
          <option value="Object">Object</option>
        </select>
        <label htmlFor={`${baseId}-entry`}>Source ID</label>
        <input id={`${baseId}-entry`} type="number" value={entry} onChange={(e) => setEntry(e.target.value)} />
        <label htmlFor={`${baseId}-chance`}>Drop chance (%)</label>
        <input id={`${baseId}-chance`} type="number" value={chance} onChange={(e) => setChance(e.target.value)} />
        <label htmlFor={`${baseId}-min`}>Min count</label>
        <input id={`${baseId}-min`} type="number" value={minCount} onChange={(e) => setMinCount(e.target.value)} />
        <label htmlFor={`${baseId}-max`}>Max count</label>
        <input id={`${baseId}-max`} type="number" value={maxCount} onChange={(e) => setMaxCount(e.target.value)} />
        <button type="button" onClick={addSource}>
          Add source
        </button>
      </div>
    </section>
  );
}

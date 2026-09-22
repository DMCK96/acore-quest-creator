import { useState } from 'react';
import type { RefKind } from '@core/db/types';
import type { FieldValue } from '@core/registry/types';
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

/** The name for one existing drop source's row, resolved through `useName` like any other id. */
function SourceName({ kind, entry }: { kind: DropSource['kind']; entry: number }): React.JSX.Element {
  const refKind: RefKind = kind === 'creature' ? 'creature' : 'gameobject';
  const { state, name } = useName(refKind, entry);
  return <>{state === 'found' ? name : `${kind} ${entry}`}</>;
}

/**
 * Edits where one required item drops from: the existing creature/gameobject sources for `itemId`,
 * with remove buttons, and a form to add another. Every add/remove calls `onChange` once per
 * touched linked rowset (the loot table and the quest-item table for that source's kind).
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

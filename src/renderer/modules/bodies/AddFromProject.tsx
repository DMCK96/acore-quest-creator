import { useId, useRef, useState } from 'react';
import type { ProjectEntities } from '@core/entities/model';
import type { QuestUse } from '@core/entities/links';
import { toggleRole, type Role } from '@core/modules/quest-roles';
import type { FieldValue } from '@core/registry/types';
import { trapTab } from '../../components/trap-tab';
import '../../views/ProjectDialog.css';

type Values = Readonly<Record<string, FieldValue>>;
type Pick = { kind: 'npc' | 'object' | 'item'; entry: number; name: string };
type Part = Role | 'required' | 'reward';

/** The item lists and how many slots `quest_template` has for each */
const ITEM_FIELD: Record<'required' | 'reward', { field: string; amount: 'count' | 'amount'; slots: number }> = {
  required: { field: 'quest_template.RequiredItems', amount: 'count', slots: 6 },
  reward: { field: 'quest_template.RewardItems', amount: 'amount', slots: 4 },
};

/** The first empty slot of an item list gets the item; null when every slot holds one */
function withItem(values: Values, part: 'required' | 'reward', item: number): FieldValue | null {
  const { field, amount, slots } = ITEM_FIELD[part];
  const rows = Array.isArray(values[field]) ? [...(values[field] as Array<Record<string, unknown>>)] : [];
  const free = rows.findIndex((r) => !(typeof r.item === 'number' && r.item > 0));
  if (free >= 0) rows[free] = { ...rows[free], item, [amount]: 1 };
  else if (rows.length < slots) rows.push({ item, [amount]: 1 });
  else return null;
  return rows as unknown as FieldValue;
}

/**
 * Adds one of the project's NPCs, objects or items the quest does not use yet, in a part it plays: a
 * giver, ender or objective, or a required or reward item. The part is written into the quest, as its
 * own panel would; that use is what lists it.
 */
export function AddFromProject({ store, use, values, onChange, onClose }: {
  store: ProjectEntities;
  use: QuestUse;
  values: Values;
  onChange(fieldId: string, value: FieldValue): void;
  onClose(): void;
}): React.JSX.Element {
  const dialog = useRef<HTMLDivElement>(null);
  const group = useId();
  const choices: Pick[] = [
    ...store.npcs.filter((n) => !use.npcs.includes(n.entry)).map((n) => ({ kind: 'npc' as const, entry: n.entry, name: n.name.trim() || `New NPC ${n.entry}` })),
    ...store.objects.filter((o) => !use.objects.includes(o.entry)).map((o) => ({ kind: 'object' as const, entry: o.entry, name: o.name.trim() || `New object ${o.entry}` })),
    ...store.items.filter((i) => !use.items.includes(i.entry)).map((i) => ({ kind: 'item' as const, entry: i.entry, name: i.name.trim() || `New item ${i.entry}` })),
  ];
  const [picked, setPicked] = useState<Pick | null>(null);
  const [part, setPart] = useState<Part | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const parts: readonly (readonly [Part, string])[] = picked?.kind === 'item'
    ? [['required', 'Required item'], ['reward', 'Reward']]
    : [['giver', 'Giver'], ['ender', 'Ender'], ['objective', 'Objective']];
  const word = { npc: 'NPC', object: 'Object', item: 'Item' };

  function add(): void {
    if (!picked || !part) return;
    if (picked.kind === 'item') {
      const next = withItem(values, part as 'required' | 'reward', picked.entry);
      if (!next) {
        setProblem('All item slots are in use.');
        return;
      }
      onChange(ITEM_FIELD[part as 'required' | 'reward'].field, next);
    } else {
      const edits = toggleRole(values, part as Role, { kind: picked.kind === 'npc' ? 'creature' : 'gameobject', id: picked.entry }, true);
      if (!edits) {
        setProblem('All objective slots are in use.');
        return;
      }
      for (const [fieldId, value] of Object.entries(edits)) onChange(fieldId, value);
    }
    onClose();
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={dialog} className="modal" role="dialog" aria-modal="true" aria-label="Add from the project"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          trapTab(e, dialog.current);
        }}>
        <header className="modal__header">
          <h2>Add from the project</h2>
          <button type="button" className="btn btn--icon" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        {choices.length === 0 ? (
          <p className="scene-hint">Every NPC, object and item in the project is already used by this quest.</p>
        ) : (
          <ul role="listbox" aria-label="The project's NPCs, objects and items" className="entity-list">
            {choices.map((c) => (
              <li key={`${c.kind}:${c.entry}`} role="option" aria-selected={picked === c} tabIndex={0} className="entity-row"
                onClick={() => {
                  setPicked(c);
                  setPart(null);
                  setProblem(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setPicked(c);
                    setPart(null);
                  }
                }}>
                {`${c.name} · ${word[c.kind]} ${c.entry}`}
              </li>
            ))}
          </ul>
        )}
        {picked && (
          <div role="radiogroup" aria-label="Its part in the quest" className="place-dialog__kinds">
            {parts.map(([value, label]) => (
              <label key={value}>
                <input type="radio" name={group} checked={part === value} onChange={() => setPart(value)} />
                {label}
              </label>
            ))}
          </div>
        )}
        {problem && <p className="scene-warning">{problem}</p>}
        <footer className="scripts-body__add">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" disabled={!picked || !part} onClick={add}>
            Add
          </button>
        </footer>
      </div>
    </div>
  );
}

import type { QuestAggregate } from '@core/model/aggregate';
import { fieldById } from '@core/registry';
import type { CreatureOrGoValue, FieldValue, ListMemberDef, ScalarValue } from '@core/registry/types';
import { addEntry, moveEntry, removeEntry } from '@core/modules/entries';
import { resolveControl } from '../controls/resolve';
import { defaultForType } from '../controls/defaults';
import { EntityPicker } from '../controls/EntityPicker';
import { FactionSelect } from '../controls/FactionSelect';
import { AggregateProvider } from '../state/aggregate-context';
import { searchKindOf } from './FieldSetting';
import './modules.css';

type Entry = Record<string, ScalarValue>;

export interface ListFieldEditorProps {
  fieldId: string;
  aggregate: QuestAggregate;
  onChange(fieldId: string, value: FieldValue): void;
  /** What one entry is called, singular: "reward item". */
  noun: string;
  addLabel: string;
  title(entry: Entry, index: number): string;
  blank?: Entry;
  help?: string;
}

/** Members that count something start at one, so a fresh card is already a sensible objective. */
const COUNT_MEMBERS = new Set(['count', 'amount', 'quantity']);

function blankEntry(members: readonly ListMemberDef[]): Entry {
  const entry: Entry = {};
  for (const m of members) entry[m.name] = COUNT_MEMBERS.has(m.name) ? 1 : defaultForType(m.type);
  return entry;
}

/**
 * A list field as a stack of cards: one per entry, each member edited with the friendliest control
 * that fits, plus add, remove and reorder. Adding stops at the table's slot count and says so, so an
 * export never meets more entries than the columns can hold.
 */
export function ListFieldEditor(props: ListFieldEditorProps): React.JSX.Element | null {
  const { fieldId, aggregate, onChange, noun, addLabel, title, blank, help } = props;
  const field = fieldById(fieldId);
  if (!field || field.shape !== 'list' || !Object.prototype.hasOwnProperty.call(aggregate.values, fieldId)) return null;

  const entries = (aggregate.values[fieldId] as Entry[] | null) ?? [];
  const reason = aggregate.readOnly.find((r) => r.fieldId === fieldId)?.reason;
  const disabled = !!reason;
  const full = entries.length >= field.slots;
  const write = (next: Entry[]): void => onChange(fieldId, next);
  const setMember = (index: number, name: string, value: ScalarValue): void =>
    write(entries.map((e, i) => (i === index ? { ...e, [name]: value } : e)));

  function memberInput(member: ListMemberDef, entry: Entry, index: number): React.JSX.Element {
    const n = index + 1;
    const id = `${fieldId}.${index}.${member.name}`;
    const label = `${member.label} ${n}`;
    const value = entry[member.name];
    const numeric = typeof value === 'number' ? value : 0;

    if (member.type.kind === 'creatureOrGo') {
      const target = (value as CreatureOrGoValue | null) ?? { target: 'creature', id: 0 };
      return (
        <div key={member.name} className="entry-card__target">
          <label htmlFor={`${id}.kind`}>{`Kind ${n}`}</label>
          <select id={`${id}.kind`} value={target.target} disabled={disabled}
            onChange={(e) => setMember(index, member.name, { target: e.target.value as CreatureOrGoValue['target'], id: 0 })}>
            <option value="creature">NPC</option>
            <option value="gameobject">Object</option>
          </select>
          <EntityPicker id={id} label={label} kind={target.target} value={target.id} disabled={disabled}
            onChange={(picked) => setMember(index, member.name, { target: target.target, id: picked })} />
        </div>
      );
    }
    const kind = searchKindOf(member.type);
    if (kind) {
      return (
        <EntityPicker key={member.name} id={id} label={label} kind={kind} value={numeric} disabled={disabled}
          onChange={(picked) => setMember(index, member.name, picked)} />
      );
    }
    if (member.type.kind === 'idRef' && member.type.target === 'faction') {
      return (
        <FactionSelect key={member.name} id={id} label={label} value={numeric} disabled={disabled}
          onChange={(picked) => setMember(index, member.name, picked)} />
      );
    }
    const Control = resolveControl(member);
    return (
      <Control key={member.name} id={id} label={label} value={value} disabled={disabled} def={member} type={member.type}
        onChange={(next: ScalarValue) => setMember(index, member.name, next)} />
    );
  }

  return (
    <AggregateProvider aggregate={aggregate}>
      <div className="entry-list" data-field={fieldId}>
        {help && <p className="entry-list__help">{help}</p>}
        {entries.map((entry, i) => (
          <section key={i} className="entry-card" aria-label={`${noun} ${i + 1}`}>
            <header className="entry-card__head">
              <h4 className="entry-card__title">{title(entry, i)}</h4>
              <div className="entry-card__actions">
                <button type="button" className="entry-card__btn" aria-label={`Move ${noun} ${i + 1} up`}
                  disabled={disabled || i === 0} onClick={() => write(moveEntry(entries, i, i - 1))}>↑</button>
                <button type="button" className="entry-card__btn" aria-label={`Move ${noun} ${i + 1} down`}
                  disabled={disabled || i === entries.length - 1} onClick={() => write(moveEntry(entries, i, i + 1))}>↓</button>
                <button type="button" className="entry-card__btn entry-card__btn--danger" aria-label={`Remove ${noun} ${i + 1}`}
                  disabled={disabled} onClick={() => write(removeEntry(entries, i))}>Remove</button>
              </div>
            </header>
            <div className="entry-card__body">{field.members.map((m) => memberInput(m, entry, i))}</div>
          </section>
        ))}
        <div className="entry-list__add">
          <button type="button" className="btn" disabled={disabled || full}
            onClick={() => write(addEntry(entries, blank ?? blankEntry(field.members), field.slots))}>
            {addLabel}
          </button>
          {full && <span className="entry-list__limit">{`A quest can have at most ${field.slots} ${noun}s.`}</span>}
        </div>
        {reason && <p role="alert">{reason}</p>}
      </div>
    </AggregateProvider>
  );
}

import type { ListFieldDef, ListValue } from '@core/registry/types';
import { EMOTES } from './game-data';
import { IntControl } from './IntControl';
import type { ControlProps, FieldControl } from './types';

/** One `idRef` emote column, such as `EmoteOnComplete` or a slot of the `Emotes` list. */
function EmoteScalar(props: ControlProps<number>): React.JSX.Element {
  const { id, label, help, value, onChange, disabled, readOnlyReason } = props;
  const known = EMOTES.find((e) => e.value === value);
  const listId = `${id}-emotes`;

  return (
    <div className="control">
      <label htmlFor={id} className="control__label">{label}</label>
      {help && <p className="control__help">{help}</p>}
      <input
        id={id}
        type="number"
        list={listId}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
      />
      <datalist id={listId}>
        {EMOTES.map((e) => (
          <option key={e.value} value={e.value} label={e.label}>
            {`${e.value} - ${e.label}`}
          </option>
        ))}
      </datalist>
      {value !== 0 && <p className="control__note">{known ? known.label : `Custom emote (${value})`}</p>}
      {readOnlyReason && <p role="alert" className="control__alert">{readOnlyReason}</p>}
    </div>
  );
}

/** The `Emotes` list (emote + delay pairs), such as `quest_details.Emotes`. */
function EmoteList(props: ControlProps<ListValue> & { def: ListFieldDef }): React.JSX.Element {
  const { def, value, onChange, disabled, readOnlyReason } = props;
  const baseId = props.id ?? def.id;
  const label = props.label ?? def.label;
  const atCap = value.length >= def.slots;
  const emoteMember = def.members.find((m) => m.name === 'emote') ?? def.members[0];
  const delayMember = def.members.find((m) => m.name === 'delay') ?? def.members[1];

  function updateRow(index: number, member: string, next: number): void {
    onChange(value.map((row, i) => (i === index ? { ...row, [member]: next } : row)));
  }

  function addRow(): void {
    onChange([...value, { [emoteMember.name]: 0, [delayMember.name]: 0 }]);
  }

  function removeRow(index: number): void {
    onChange(value.filter((_, i) => i !== index));
  }

  return (
    <fieldset className="control">
      <legend className="control__label">{label}</legend>
      {def.help && <p className="control__help">{def.help}</p>}
      {value.map((row, index) => (
        <div key={index} className="control__row">
          <EmoteScalar
            id={`${baseId}-${index}-${emoteMember.name}`}
            label={emoteMember.label}
            value={(row[emoteMember.name] as number) ?? 0}
            disabled={disabled}
            onChange={(next) => updateRow(index, emoteMember.name, next)}
          />
          <IntControl
            id={`${baseId}-${index}-${delayMember.name}`}
            label={delayMember.label}
            value={(row[delayMember.name] as number) ?? 0}
            disabled={disabled}
            onChange={(next) => updateRow(index, delayMember.name, next ?? 0)}
            type={delayMember.type as Extract<typeof delayMember.type, { kind: 'int' }>}
          />
          <button type="button" className="btn btn--small btn--danger" disabled={disabled} onClick={() => removeRow(index)}>
            {`Remove ${label} ${index + 1}`}
          </button>
        </div>
      ))}
      <button type="button" className="btn btn--small" disabled={disabled || atCap} onClick={addRow}>
        Add
      </button>
      {atCap && <p className="control__note">{`At most ${def.slots} entries.`}</p>}
      {readOnlyReason && <p role="alert" className="control__alert">{readOnlyReason}</p>}
    </fieldset>
  );
}

/**
 * The registered `emote` control. It edits a single `idRef` emote column when `def` is a scalar
 * field (or a list member, or the bare `{}` a caller passes when testing the control directly),
 * and edits the whole `Emotes` list (emote + delay pairs) when `def` is that `ListFieldDef` itself
 * - `resolveControl` hands a `ListFieldDef` with `control: 'emote'` straight to this component
 * rather than to `ListEditor`, so this control has to cover both shapes.
 */
export function EmoteControl(props: ControlProps<any>): React.JSX.Element {
  const { def } = props;
  if (def && 'shape' in def && def.shape === 'list') {
    return <EmoteList {...(props as ControlProps<ListValue>)} def={def as ListFieldDef} />;
  }
  return <EmoteScalar {...(props as ControlProps<number>)} />;
}

export const EmoteFieldControl = EmoteControl as unknown as FieldControl;

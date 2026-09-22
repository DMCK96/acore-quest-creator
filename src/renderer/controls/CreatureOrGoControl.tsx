import type { RefKind } from '@core/db/types';
import type { CreatureOrGoValue } from '@core/registry/types';
import { useName } from '../state/names';
import type { ControlProps, FieldControl } from './types';

export function CreatureOrGoControl(props: ControlProps<CreatureOrGoValue | null>): React.JSX.Element {
  const { id, label, help, value, onChange, disabled, readOnlyReason } = props;
  const target = value?.target ?? 'creature';
  const refId = value?.id ?? 0;
  const kind: RefKind = target === 'creature' ? 'creature' : 'gameobject';
  const { state, name } = useName(kind, refId);

  return (
    <div>
      {help && <p>{help}</p>}
      <label htmlFor={`${id}-type`}>{`${label} type`}</label>
      <select
        id={`${id}-type`}
        value={target === 'creature' ? 'Creature' : 'Object'}
        disabled={disabled}
        onChange={(e) => onChange({ target: e.target.value === 'Object' ? 'gameobject' : 'creature', id: refId })}
      >
        <option value="Creature">Creature</option>
        <option value="Object">Object</option>
      </select>
      <label htmlFor={`${id}-id`}>{`${label} ID`}</label>
      <input
        id={`${id}-id`}
        type="number"
        value={refId}
        disabled={disabled}
        onChange={(e) => onChange({ target, id: Number(e.target.value) || 0 })}
      />
      {state === 'found' && <p>{name}</p>}
      {state === 'missing' && <p>ID not found in your database.</p>}
      {readOnlyReason && <p role="alert">{readOnlyReason}</p>}
    </div>
  );
}

export const CreatureOrGoFieldControl = CreatureOrGoControl as unknown as FieldControl;

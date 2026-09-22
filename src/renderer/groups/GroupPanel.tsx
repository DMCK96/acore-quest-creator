import { resolveControl } from '../controls/resolve';
import type { EditorGroup, FieldDef, FieldValue } from '@core/registry/types';
import { fieldsOfGroup } from '@core/registry';
import type { QuestAggregate } from '@core/model/aggregate';

export interface GroupPanelProps {
  group: EditorGroup;
  aggregate: QuestAggregate;
  onChange(fieldId: string, value: FieldValue): void;
}

/**
 * Renders every field of `group`, in registry order, using the control `resolveControl` picks.
 *
 * A field missing from `aggregate.values` (schema drift the importer could not decode into a
 * value at all) is omitted entirely rather than shown broken. `advanced` fields are grouped under
 * a collapsed "Advanced" `<details>`. A field named in `aggregate.readOnly` is still shown, but
 * disabled, with its reason displayed.
 */
export function GroupPanel({ group, aggregate, onChange }: GroupPanelProps): React.JSX.Element {
  const present = fieldsOfGroup(group).filter((f) => Object.prototype.hasOwnProperty.call(aggregate.values, f.id));
  const basic = present.filter((f) => !f.advanced);
  const advanced = present.filter((f) => f.advanced);
  const readOnlyReasons = new Map(aggregate.readOnly.map((r) => [r.fieldId, r.reason]));

  function renderField(field: FieldDef): React.JSX.Element {
    const Control = resolveControl(field);
    const reason = readOnlyReasons.get(field.id);
    return (
      <div key={field.id}>
        <Control
          id={field.id}
          label={field.label}
          help={field.help}
          value={aggregate.values[field.id]}
          onChange={(next: FieldValue) => onChange(field.id, next)}
          disabled={!!reason}
          readOnlyReason={reason}
          def={field}
          type={field.shape === 'scalar' ? field.type : undefined}
        />
      </div>
    );
  }

  return (
    <div>
      {basic.map(renderField)}
      {advanced.length > 0 && (
        <details>
          <summary>Advanced</summary>
          {advanced.map(renderField)}
        </details>
      )}
    </div>
  );
}

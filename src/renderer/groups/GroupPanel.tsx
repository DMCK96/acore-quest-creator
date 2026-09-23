import { resolveControl } from '../controls/resolve';
import { AggregateProvider } from '../state/aggregate-context';
import type { EditorGroup, FieldDef, FieldValue } from '@core/registry/types';
import { fieldsOfGroup } from '@core/registry';
import type { QuestAggregate } from '@core/model/aggregate';
import { GROUP_LAYOUT } from './layout';

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
 * disabled, with its reason displayed. A field marked `readOnlyUi` in the registry (an identifying
 * value such as the quest ID, never editable regardless of drift) is likewise shown disabled, with
 * no reason text since there is nothing wrong with it to explain.
 */
/**
 * Orders `fields` by `GROUP_LAYOUT[group]`; a field not named there keeps its relative registry
 * order, appended after every field that is named (a stable sort with an `Infinity` rank for the
 * unlisted ones does exactly this).
 */
function orderByLayout(fields: readonly FieldDef[], group: EditorGroup): FieldDef[] {
  const rank = new Map(GROUP_LAYOUT[group].map((id, i) => [id, i]));
  return [...fields].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
}

export function GroupPanel({ group, aggregate, onChange }: GroupPanelProps): React.JSX.Element {
  const present = orderByLayout(
    fieldsOfGroup(group)
      .filter((f) => Object.prototype.hasOwnProperty.call(aggregate.values, f.id))
      // Linked rowsets (creature/gameobject loot and quest-item rows) are edited through the
      // drops model's own UI, not as a raw table of rows the user would have to hand-edit.
      .filter((f) => !(f.shape === 'rowset' && f.linked)),
    group,
  );
  const basic = present.filter((f) => !f.advanced);
  const advanced = present.filter((f) => f.advanced);
  const readOnlyReasons = new Map(aggregate.readOnly.map((r) => [r.fieldId, r.reason]));

  function renderField(field: FieldDef): React.JSX.Element {
    const Control = resolveControl(field);
    const reason = readOnlyReasons.get(field.id);
    const readOnlyUi = field.shape === 'scalar' && field.readOnlyUi === true;
    return (
      <div key={field.id} data-field={field.id}>
        <Control
          id={field.id}
          label={field.label}
          help={field.help}
          value={aggregate.values[field.id]}
          onChange={(next: FieldValue) => onChange(field.id, next)}
          disabled={!!reason || readOnlyUi}
          readOnlyReason={reason}
          def={field}
          type={field.shape === 'scalar' ? field.type : undefined}
        />
      </div>
    );
  }

  return (
    <AggregateProvider aggregate={aggregate}>
      <div>
        {basic.map(renderField)}
        {advanced.length > 0 && (
          <details>
            <summary>Advanced</summary>
            {advanced.map(renderField)}
          </details>
        )}
      </div>
    </AggregateProvider>
  );
}

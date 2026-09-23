import type { QuestAggregate } from '@core/model/aggregate';
import { fieldById } from '@core/registry';
import type { FieldDef, FieldValue, ScalarType } from '@core/registry/types';
import type { SearchKind } from '@core/db/world-db';
import { resolveControl } from '../controls/resolve';
import { EntityPicker } from '../controls/EntityPicker';
import { FactionSelect } from '../controls/FactionSelect';
import { SkillSelect } from '../controls/SkillSelect';
import { AggregateProvider } from '../state/aggregate-context';

const SEARCH_KINDS: readonly string[] = ['item', 'creature', 'gameobject', 'quest'];

/** The search kind a scalar type is picked by, or `undefined` when it is not a searchable reference. */
export function searchKindOf(type: ScalarType): SearchKind | undefined {
  return type.kind === 'idRef' && SEARCH_KINDS.includes(type.target) ? (type.target as SearchKind) : undefined;
}

export interface FieldSettingProps {
  fieldId: string;
  aggregate: QuestAggregate;
  onChange(fieldId: string, value: FieldValue): void;
  label?: string;
  help?: string;
  /** Use the registry's own control even for a reference that could be searched (Advanced). */
  raw?: boolean;
}

/**
 * One registry field, edited with the friendliest control that fits: a name search for items,
 * NPCs, objects and quests, a dropdown for factions and skills, the registry's control otherwise.
 * A field the quest does not carry (schema drift) renders nothing; a read-only one is disabled
 * with its reason.
 */
export function FieldSetting({ fieldId, aggregate, onChange, label, help, raw }: FieldSettingProps): React.JSX.Element | null {
  const field = fieldById(fieldId);
  if (!field || !Object.prototype.hasOwnProperty.call(aggregate.values, fieldId)) return null;

  const reason = aggregate.readOnly.find((r) => r.fieldId === fieldId)?.reason;
  const readOnlyUi = field.shape === 'scalar' && field.readOnlyUi === true;
  const disabled = !!reason || readOnlyUi;
  const shownLabel = label ?? field.label;
  const value = aggregate.values[fieldId];

  return (
    <AggregateProvider aggregate={aggregate}>
      <div className="field-setting" data-field={fieldId}>
        {renderControl(field, raw)}
      </div>
    </AggregateProvider>
  );

  function renderControl(def: FieldDef, useRaw: boolean | undefined): React.JSX.Element {
    if (!useRaw && def.shape === 'scalar') {
      const kind = searchKindOf(def.type);
      const numeric = typeof value === 'number' ? value : 0;
      const set = (id: number): void => onChange(fieldId, id);
      if (kind) {
        return (
          <EntityPicker id={fieldId} label={shownLabel} kind={kind} value={numeric} onChange={set}
            disabled={disabled} readOnlyReason={reason} />
        );
      }
      if (def.type.kind === 'idRef' && def.type.target === 'faction') {
        return <FactionSelect id={fieldId} label={shownLabel} value={numeric} onChange={set} disabled={disabled} />;
      }
      if (def.type.kind === 'idRef' && def.type.target === 'skill') {
        return <SkillSelect id={fieldId} label={shownLabel} value={numeric} onChange={set} disabled={disabled} />;
      }
    }
    const Control = resolveControl(def);
    return (
      <Control
        id={fieldId}
        label={shownLabel}
        help={help ?? def.help}
        value={value}
        onChange={(next: FieldValue) => onChange(fieldId, next)}
        disabled={disabled}
        readOnlyReason={reason}
        def={def}
        type={def.shape === 'scalar' ? def.type : undefined}
      />
    );
  }
}

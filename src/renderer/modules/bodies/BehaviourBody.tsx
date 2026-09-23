import { useState } from 'react';
import { fieldById } from '@core/registry';
import type { ModuleBodyProps } from '../body-props';
import { FieldSetting } from '../FieldSetting';

const FLAGS = 'quest_template.Flags';
const SPECIAL = 'quest_template_addon.SpecialFlags';

/** The flags people actually set, by field and bit; every other bit stays under "All flags". */
const TOGGLES: ReadonlyArray<readonly [string, number]> = [
  [FLAGS, 0x8],
  [FLAGS, 0x1000],
  [FLAGS, 0x8000],
  [SPECIAL, 0x1],
  [FLAGS, 0x10000],
  [FLAGS, 0x1],
  [FLAGS, 0x200],
];

function flagLabel(fieldId: string, bit: number): string {
  const field = fieldById(fieldId);
  const flag = field?.shape === 'scalar' && field.type.kind === 'flags' ? field.type.flags.find((f) => f.bit === bit) : undefined;
  return flag?.label ?? `Bit ${bit}`;
}

/** Sharing, repeating, auto-complete and the like as named switches, each flipping one bit. */
export function BehaviourBody({ open, onChange }: ModuleBodyProps): React.JSX.Element {
  const { aggregate } = open;
  // The full flag lists repeat these switches, so they only mount once opened.
  const [showAll, setShowAll] = useState(false);
  const readOnly = new Set(aggregate.readOnly.map((r) => r.fieldId));

  return (
    <div>
      {TOGGLES.filter(([fieldId]) => Object.prototype.hasOwnProperty.call(aggregate.values, fieldId)).map(([fieldId, bit]) => {
        const value = Number(aggregate.values[fieldId] ?? 0);
        const id = `${fieldId}.${bit}`;
        return (
          <div key={id} className="field-setting">
            <input id={id} type="checkbox" checked={(value & bit) !== 0} disabled={readOnly.has(fieldId)}
              onChange={() => onChange(fieldId, value ^ bit)} />
            <label htmlFor={id}>{flagLabel(fieldId, bit)}</label>
          </div>
        );
      })}
      <details onToggle={(e) => setShowAll((e.target as HTMLDetailsElement).open)}>
        <summary>All flags</summary>
        {showAll && (
          <>
            <FieldSetting raw fieldId={FLAGS} aggregate={aggregate} onChange={onChange} />
            <FieldSetting raw fieldId={SPECIAL} aggregate={aggregate} onChange={onChange} />
          </>
        )}
      </details>
    </div>
  );
}

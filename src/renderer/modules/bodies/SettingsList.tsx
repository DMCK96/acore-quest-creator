import type { ModuleBodyProps } from '../body-props';
import { FieldSetting } from '../FieldSetting';

/** A body that is only a list of settings, each with the label it shows in this module. */
export function SettingsList({
  open,
  onChange,
  fields,
}: ModuleBodyProps & { fields: ReadonlyArray<readonly [fieldId: string, label?: string, help?: string]> }): React.JSX.Element {
  return (
    <div>
      {fields.map(([fieldId, label, help]) => (
        <FieldSetting key={fieldId} fieldId={fieldId} label={label} help={help} aggregate={open.aggregate} onChange={onChange} />
      ))}
    </div>
  );
}

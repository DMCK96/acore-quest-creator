import type { ModuleId } from '@core/modules/model';
import { moduleById } from '@core/modules/catalog';
import type { ModuleBodyComponent, ModuleBodyProps } from './body-props';
import { FieldSetting } from './FieldSetting';
import { GiverBody } from './bodies/GiverBody';
import { DialogueBody } from './bodies/DialogueBody';

export type { ModuleBodyProps } from './body-props';

/** The panel content of each module. */
export const MODULE_BODIES: Partial<Record<ModuleId, ModuleBodyComponent>> = {
  giver: GiverBody,
  dialogue: DialogueBody,
};

/** Renders module `id`'s body; a module without one yet lists its fields as plain settings. */
export function ModuleBody({ id, ...props }: ModuleBodyProps & { id: ModuleId }): React.JSX.Element {
  const Body = MODULE_BODIES[id];
  if (Body) return <Body {...props} />;
  return (
    <div>
      {moduleById(id).owns.map((fieldId) => (
        <FieldSetting key={fieldId} fieldId={fieldId} aggregate={props.open.aggregate} onChange={props.onChange} />
      ))}
    </div>
  );
}

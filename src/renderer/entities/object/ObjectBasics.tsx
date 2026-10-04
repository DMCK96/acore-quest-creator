import type { CustomObject, ObjectType } from '@core/entities/model';
import { CheckField, SelectField, TextField } from '../../scripts/fields';

export const OBJECT_TYPES: readonly (readonly [ObjectType, string])[] = [
  ['goober', 'Usable object'],
  ['chest', 'Chest (can be looted)'],
  ['questGiver', 'Quest giver'],
  ['text', 'Readable'],
  ['generic', 'Decoration'],
];

/** The object's name and kind, and whether only players on the quest may use it. */
export function ObjectBasics({ object, onChange, questId = null }: { object: CustomObject; onChange(next: CustomObject): void; questId?: number | null }): React.JSX.Element {
  return (
    <div className="scripts-body">
      <TextField label="Name" value={object.name} onChange={(name) => onChange({ ...object, name })} />
      <SelectField label="Type" value={object.type} options={OBJECT_TYPES} onChange={(type) => onChange({ ...object, type })} />
      {(object.type === 'goober' || object.type === 'chest') && (
        <CheckField label="Only usable while this quest is in the log" value={object.onlyDuringQuest !== null}
          onChange={(on) => onChange({ ...object, onlyDuringQuest: on ? questId : null })} />
      )}
    </div>
  );
}

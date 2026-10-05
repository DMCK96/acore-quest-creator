import type { CustomObject, ObjectType } from '@core/entities/model';
import { SelectField, TextField } from '../../scripts/fields';

export const OBJECT_TYPES: readonly (readonly [ObjectType, string])[] = [
  ['goober', 'Usable object'],
  ['chest', 'Lootable'],
  ['questGiver', 'Quest giver'],
  ['text', 'Readable'],
  ['generic', 'Decoration'],
];

/** The object's name and kind, and the quest a player must have to use or loot it, if any. */
export function ObjectBasics({
  object,
  onChange,
  quests = [],
  typeLocked = false,
}: {
  object: CustomObject;
  onChange(next: CustomObject): void;
  /** An existing object of a type this editor does not have: its type is kept, not offered */
  typeLocked?: boolean;
  /** The quests it can be limited to */
  quests?: readonly { questId: number; title: string }[];
}): React.JSX.Element {
  // A quest no longer in the project is still shown, by its id, until another is picked
  const choices = object.onlyDuringQuest !== null && !quests.some((q) => q.questId === object.onlyDuringQuest)
    ? [...quests, { questId: object.onlyDuringQuest, title: `Quest ${object.onlyDuringQuest}` }]
    : quests;
  return (
    <div className="scripts-body">
      <TextField label="Name" value={object.name} onChange={(name) => onChange({ ...object, name })} />
      {typeLocked ? (
        <p className="scene-hint">Its type is one this editor does not change.</p>
      ) : (
        <SelectField label="Type" value={object.type} options={OBJECT_TYPES} onChange={(type) => onChange({ ...object, type })} />
      )}
      {!typeLocked && (object.type === 'goober' || object.type === 'chest') && (
        <SelectField label="Only while on the quest" value={object.onlyDuringQuest === null ? '' : String(object.onlyDuringQuest)}
          options={[['', 'Anyone'] as const, ...choices.map((q) => [String(q.questId), q.title] as const)]}
          onChange={(v) => onChange({ ...object, onlyDuringQuest: v === '' ? null : Number(v) })} />
      )}
    </div>
  );
}

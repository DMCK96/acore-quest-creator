import { EntityPicker } from './EntityPicker';
import type { ControlProps, FieldControl } from './types';

/**
 * Edits `QuestSortID`, the heading the quest is listed under in the player's quest log: a zone
 * ("Elwynn Forest", a positive AreaTable id) or a category ("Warrior", "Seasonal", a QuestSort id
 * with its sign flipped). One search finds both by name and stores whichever is picked, so there is
 * no zone/category switch to flip, and nothing is cleared by looking.
 */
export function QuestSortControl(props: ControlProps<number>): React.JSX.Element {
  const { id, label, help, value, onChange, disabled, readOnlyReason } = props;
  return (
    <div className="control quest-sort">
      <EntityPicker id={id} label={label} kind="questSort" value={value} onChange={onChange} disabled={disabled}
        readOnlyReason={readOnlyReason} />
      {help && <p className="control__help">{help}</p>}
    </div>
  );
}

export const QuestSortFieldControl = QuestSortControl as unknown as FieldControl;

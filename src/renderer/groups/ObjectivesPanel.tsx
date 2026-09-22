import type { FieldValue, ListValue } from '@core/registry/types';
import type { QuestAggregate } from '@core/model/aggregate';
import { DropsPanel } from './DropsPanel';
import { GroupPanel } from './GroupPanel';

export interface ObjectivesPanelProps {
  aggregate: QuestAggregate;
  onChange(fieldId: string, value: FieldValue): void;
}

const REQUIRED_ITEMS_FIELD = 'quest_template.RequiredItems';
const START_ITEM_FIELD = 'quest_template.StartItem';

/** The nonzero item ids the quest requires, plus its start item, in the order they should list. */
function requiredItemIds(values: Record<string, FieldValue>): number[] {
  const ids: number[] = [];
  const seen = new Set<number>();
  const add = (id: number): void => {
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  };
  const requiredItems = (values[REQUIRED_ITEMS_FIELD] as ListValue | undefined) ?? [];
  for (const row of requiredItems) add(row.item as number);
  add((values[START_ITEM_FIELD] as number | undefined) ?? 0);
  return ids;
}

/**
 * The objectives group: `GroupPanel('objectives')` (which skips the linked loot/quest-item
 * rowsets) followed by one `DropsPanel` per required item and the start item, so where each one
 * comes from is edited right next to the objectives that need it.
 */
export function ObjectivesPanel({ aggregate, onChange }: ObjectivesPanelProps): React.JSX.Element {
  const itemIds = requiredItemIds(aggregate.values);
  return (
    <div>
      <GroupPanel group="objectives" aggregate={aggregate} onChange={onChange} />
      {itemIds.map((itemId) => (
        <DropsPanel
          key={itemId}
          itemId={itemId}
          values={aggregate.values}
          sharedItems={aggregate.sharedItems}
          onChange={onChange}
        />
      ))}
    </div>
  );
}

import { instanceId, type ComponentInstance, type RowRef } from '../model';
import { endpointName } from '../describe';
import type { ComponentDef, RecogniseInput } from '../component';
import { ITEM_READ_ONLY } from './smartai';

/**
 * An item whose `startquest` names the quest: using it begins the quest. The row belongs to the item,
 * not the quest, so it is shown for provenance but left to an item editor to change.
 */
export const startItem: ComponentDef = {
  id: 'start.item',
  label: 'Begun by an item',
  help: 'Begun by an item',
  hook: 'start',
  action: 'offerQuest',
  mechanism: 'item',
  params: [
    { name: 'item', label: 'Item', type: { kind: 'idRef', target: 'item' } },
    { name: 'quest', label: 'Quest', type: { kind: 'idRef', target: 'quest' } },
  ],
  requires: [{ table: 'item_template', columns: ['entry', 'startquest'] }],
  writable: false,
  recognise(input: RecogniseInput): ComponentInstance[] {
    return input.context.itemStarters
      .filter((s) => input.facts.has(s.questId))
      .map((s) => {
        const claim: RowRef = { table: 'item_template', key: `entry=${s.entry}`, column: 'startquest' };
        return {
          id: instanceId('start.item', [claim]),
          component: 'start.item',
          owner: s.questId,
          from: { kind: 'item', entry: s.entry },
          to: { kind: 'quest', questId: s.questId },
          params: { item: s.entry, quest: s.questId },
          claims: [claim],
          editable: false,
          readOnlyReason: ITEM_READ_ONLY,
        };
      });
  },
  describe(instance, names): string {
    return `Begun by ${endpointName(instance.from, names)}`;
  },
};

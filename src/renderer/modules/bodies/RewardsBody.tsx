import type { ScalarValue } from '@core/registry/types';
import { factionName } from '@core/game/factions';
import { itemName } from '@core/modules/summaries';
import { useNameBook } from '../../state/names';
import type { ModuleBodyProps } from '../body-props';
import { FieldSetting } from '../FieldSetting';
import { ListFieldEditor } from '../ListFieldEditor';

type Entry = Record<string, ScalarValue>;

/** Experience, money, items (given and chosen) and reputation. */
export function RewardsBody({ open, onChange }: ModuleBodyProps): React.JSX.Element {
  const { aggregate } = open;
  const names = useNameBook();
  const itemTitle =
    (count: string) =>
    (e: Entry): string =>
      e.item ? `${e[count]} × ${itemName(Number(e.item), names)}` : 'Choose an item';
  const factionTitle = (e: Entry): string =>
    e.faction ? (factionName(Number(e.faction)) ?? `Faction #${e.faction}`) : 'Choose a faction';

  return (
    <div>
      <FieldSetting fieldId="quest_template.RewardXPDifficulty" aggregate={aggregate} onChange={onChange} />
      <FieldSetting fieldId="quest_template.RewardMoney" aggregate={aggregate} onChange={onChange} />
      <FieldSetting fieldId="quest_template.RewardMoneyDifficulty" aggregate={aggregate} onChange={onChange} />

      <h3 className="module-section__title">Items</h3>
      <ListFieldEditor fieldId="quest_template.RewardItems" aggregate={aggregate} onChange={onChange}
        noun="reward item" addLabel="Add reward item" title={itemTitle('amount')} />

      <h3 className="module-section__title">Choice of one</h3>
      <ListFieldEditor fieldId="quest_template.RewardChoiceItems" aggregate={aggregate} onChange={onChange}
        noun="choice" addLabel="Add choice" title={itemTitle('quantity')} />

      <h3 className="module-section__title">Reputation</h3>
      <ListFieldEditor fieldId="quest_template.RewardFactions" aggregate={aggregate} onChange={onChange}
        noun="reputation reward" addLabel="Add reputation" title={factionTitle} />
    </div>
  );
}

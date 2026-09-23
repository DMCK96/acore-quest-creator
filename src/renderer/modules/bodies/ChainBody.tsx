import { EntityPicker } from '../../controls/EntityPicker';
import type { ModuleBodyProps } from '../body-props';
import { SettingsList } from './SettingsList';

const PREV = 'quest_template_addon.PrevQuestID';

/**
 * The quests around this one. The previous quest is stored signed: positive means it must be
 * completed, negative that it must be in the quest log, so the picker edits the ID and a dropdown
 * the sign.
 */
export function ChainBody(props: ModuleBodyProps): React.JSX.Element {
  const { open, onChange } = props;
  const hasPrev = Object.prototype.hasOwnProperty.call(open.aggregate.values, PREV);
  const prev = Number(open.aggregate.values[PREV] ?? 0);
  const inLog = prev < 0;

  return (
    <div>
      {hasPrev && (
        <div className="field-setting" data-field={PREV}>
          <EntityPicker id={PREV} label="Previous quest" kind="quest" value={Math.abs(prev)}
            onChange={(id) => onChange(PREV, inLog ? -id : id)} />
          {prev !== 0 && (
            <>
              <label htmlFor={`${PREV}.sign`}>Previous quest must be</label>
              <select id={`${PREV}.sign`} value={inLog ? 'log' : 'done'}
                onChange={(e) => onChange(PREV, e.target.value === 'log' ? -Math.abs(prev) : Math.abs(prev))}>
                <option value="done">Completed</option>
                <option value="log">In the quest log</option>
              </select>
            </>
          )}
        </div>
      )}
      <SettingsList
        {...props}
        fields={[
          ['quest_template_addon.NextQuestID', 'Next quest'],
          ['quest_template_addon.BreadcrumbForQuestId', 'Breadcrumb for'],
          ['quest_template.RewardNextQuest', 'Offered next on turn-in'],
          [
            'quest_template_addon.ExclusiveGroup',
            'Exclusive group',
            'Positive: only one quest of the group can be taken. Negative: all quests of the group must be done.',
          ],
        ]}
      />
    </div>
  );
}

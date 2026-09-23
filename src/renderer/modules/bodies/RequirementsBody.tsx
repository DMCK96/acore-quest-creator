import type { ModuleBodyProps } from '../body-props';
import { ListFieldEditor } from '../ListFieldEditor';
import { SettingsList } from './SettingsList';
import { factionName } from '@core/game/factions';

/** Who may take the quest: a level cap, races and classes, a skill, and reputation bounds. */
export function RequirementsBody(props: ModuleBodyProps): React.JSX.Element {
  return (
    <div>
      <SettingsList
        {...props}
        fields={[
          ['quest_template_addon.MaxLevel', 'Max level'],
          ['quest_template.AllowableRaces', 'Races'],
          ['quest_template_addon.AllowableClasses', 'Classes'],
          ['quest_template_addon.RequiredSkillID', 'Required skill'],
          ['quest_template_addon.RequiredSkillPoints', 'Skill points'],
          ['quest_template_addon.RequiredMinRepFaction', 'Minimum reputation with'],
          ['quest_template_addon.RequiredMinRepValue', 'Minimum reputation'],
          ['quest_template_addon.RequiredMaxRepFaction', 'Maximum reputation with'],
          ['quest_template_addon.RequiredMaxRepValue', 'Maximum reputation'],
        ]}
      />
      <h3 className="module-section__title">Required reputation</h3>
      <ListFieldEditor
        fieldId="quest_template.RequiredFactions"
        aggregate={props.open.aggregate}
        onChange={props.onChange}
        noun="required reputation"
        addLabel="Add required reputation"
        title={(e) => (e.faction ? (factionName(Number(e.faction)) ?? `Faction #${e.faction}`) : 'Choose a faction')}
      />
    </div>
  );
}

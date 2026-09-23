import { moduleById } from '@core/modules/catalog';
import { UnmodelledPanel } from '../../views/UnmodelledPanel';
import type { ModuleBodyProps } from '../body-props';
import { FieldSetting } from '../FieldSetting';
import { SettingsList } from './SettingsList';

/** Where the quest points on the map: the registry's own marker controls. */
export function MapMarkerBody(props: ModuleBodyProps): React.JSX.Element {
  return <SettingsList {...props} fields={moduleById('mapMarker').owns.map((id) => [id] as const)} />;
}

/** A letter sent after the quest: which template, how long after, and from whom. */
export function MailBody(props: ModuleBodyProps): React.JSX.Element {
  return (
    <SettingsList
      {...props}
      fields={[
        ['quest_template_addon.RewardMailTemplateID', 'Mail template ID'],
        ['quest_template_addon.RewardMailDelay', 'Delay (seconds)'],
        ['quest_mail_sender.RewardMailSenderEntry', 'Mail sender'],
      ]}
    />
  );
}

/** Rewards beyond money and items. */
export function ExtraRewardsBody(props: ModuleBodyProps): React.JSX.Element {
  return (
    <SettingsList
      {...props}
      fields={[
        ['quest_template.RewardSpell', 'Spell cast on turn-in'],
        ['quest_template.RewardDisplaySpell', 'Spell shown as the reward'],
        ['quest_template.RewardTitle', 'Title ID'],
        ['quest_template.RewardTalents', 'Talent points'],
        ['quest_template.RewardHonor', 'Honor'],
        ['quest_template.RewardKillHonor', 'Kill honor'],
        ['quest_template.RewardArenaPoints', 'Arena points'],
      ]}
    />
  );
}

/** Every column no other module edits, raw, plus the columns the tool keeps but does not model. */
export function AdvancedBody({ open, onChange }: ModuleBodyProps): React.JSX.Element {
  return (
    <div>
      {moduleById('advanced').owns.map((fieldId) => (
        <FieldSetting key={fieldId} raw fieldId={fieldId} aggregate={open.aggregate} onChange={onChange} />
      ))}
      <h3 className="module-section__title">Unmodelled columns</h3>
      <UnmodelledPanel unmodelled={open.unmodelled} />
    </div>
  );
}
